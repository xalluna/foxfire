using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Foxfire.Riot;

/// <summary>A Riot account, as account-v1 describes it.</summary>
/// <param name="Puuid">Encrypted under the key that fetched it, and meaningless under any other.</param>
/// <param name="GameName">The name half of a Riot ID. Riot may omit it for accounts with no Riot ID set.</param>
/// <param name="TagLine">The tag half, without the hash.</param>
public sealed record RiotAccountDto(
    [property: JsonPropertyName("puuid")] string Puuid,
    [property: JsonPropertyName("gameName")] string? GameName,
    [property: JsonPropertyName("tagLine")] string? TagLine);

/// <summary>
/// Every call this server makes to Riot.
///
/// One choke point, exactly as on the desktop, because a choke point is what
/// makes the rate limiter, the retry policy and the key handling true of all of
/// them rather than of whichever call sites remembered. Endpoint wrappers below
/// build paths; none of them reaches the network on its own.
///
/// The key comes from configuration and never changes while the process runs.
/// That is a deliberate narrowing of what the desktop does — there, a user
/// pastes a new key into Settings and the client picks it up. Here, rotating
/// means editing the environment and restarting, which buys the absence of an
/// encrypted secrets column, a Data Protection key ring, and a volume every host
/// has to remember to mount.
/// </summary>
public sealed class RiotClient
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpFactory;
    private readonly RiotRateLimiter _limiter;
    private readonly string _apiKey;
    private readonly ILogger _log;

    /// <summary>The named HttpClient this reaches Riot through.</summary>
    public const string HttpClientName = "riot";

    public RiotClient(
        IHttpClientFactory httpFactory,
        RiotRateLimiter limiter,
        string apiKey,
        ILogger<RiotClient>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(httpFactory);
        ArgumentNullException.ThrowIfNull(limiter);
        ArgumentException.ThrowIfNullOrWhiteSpace(apiKey);

        _httpFactory = httpFactory;
        _limiter = limiter;
        _apiKey = apiKey;
        _log = logger ?? NullLogger<RiotClient>.Instance;
    }

    /// <summary>Whether Riot has refused the configured key. Reads keep working when it has.</summary>
    public bool KeyRejected => _limiter.KeyRejected;

    /// <summary>The shared queue, for the health endpoint and the admin view.</summary>
    public RiotRateLimiter Limiter => _limiter;

    /// <summary>
    /// Looks a player up by the Riot ID they would type themselves.
    ///
    /// This is the identity that survives a key change, which makes it the one
    /// that matters: puuids are encrypted per key, so the durable record of who
    /// somebody is has to be their name and tag, with the puuid re-resolved
    /// through here whenever the key moves.
    ///
    /// It is also what linking runs on. The desktop reads the Riot ID out of the
    /// running League client and reports it, and this turns that into the puuid
    /// this server will file everything under.
    /// </summary>
    public Task<RiotAccountDto> GetAccountByRiotIdAsync(
        string regionalRoute,
        string gameName,
        string tagLine,
        RiotRequestPriority priority = RiotRequestPriority.Interactive,
        CancellationToken cancellationToken = default)
    {
        var path = $"/riot/account/v1/accounts/by-riot-id/{Uri.EscapeDataString(gameName)}/{Uri.EscapeDataString(tagLine)}";

        return SendAsync<RiotAccountDto>(
            endpoint: "/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}",
            baseUrl: RiotRegions.RegionalBaseUrl(regionalRoute),
            path: path,
            priority: priority,
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Asks Riot whether the key works, without meaning anything by the answer.
    ///
    /// The same probe the desktop validates a pasted key with. Used at startup
    /// so a host finds out their key is wrong from a log line at boot rather
    /// than from a friend saying nothing syncs, and used again to re-probe a key
    /// that may have been refused by a blip rather than by being expired.
    /// </summary>
    public async Task<bool> ValidateKeyAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await SendAsync<JsonElement>(
                endpoint: "/lol/status/v4/platform-data",
                baseUrl: RiotRegions.PlatformBaseUrl(RiotRegions.DefaultPlatform),
                path: "/lol/status/v4/platform-data",
                priority: RiotRequestPriority.Interactive,
                cancellationToken: cancellationToken).ConfigureAwait(false);

            return true;
        }
        catch (RiotApiException ex) when (ex.IsKeyRejection)
        {
            return false;
        }
    }

    /// <summary>Riot's maximum page size for a match id list, and therefore ours.</summary>
    public const int MatchIdsPageSize = 100;

    /// <summary>
    /// One page of a player's match ids, newest first.
    ///
    /// Paging lives in the query string and is deliberately left out of the
    /// endpoint template, so every page of a backfill groups under one endpoint
    /// in the limiter's accounting rather than appearing as a new one per offset.
    /// </summary>
    public Task<List<string>> GetMatchIdsAsync(
        string regionalRoute,
        string puuid,
        int start,
        int count,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        var path = $"/lol/match/v5/matches/by-puuid/{Uri.EscapeDataString(puuid)}/ids?start={start}&count={count}";

        return SendAsync<List<string>>(
            endpoint: "/lol/match/v5/matches/by-puuid/{puuid}/ids",
            baseUrl: RiotRegions.RegionalBaseUrl(regionalRoute),
            path: path,
            priority: priority,
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// One whole game, parsed and verbatim.
    ///
    /// The raw text comes back with it because that is what gets stored. See
    /// <see cref="RawMatch"/>: re-serialising the parse would silently drop every
    /// field this version of the code does not model, which is exactly the set a
    /// future migration would want to backfill from.
    /// </summary>
    public async Task<RawMatch> GetMatchAsync(
        string regionalRoute,
        string matchId,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        const string Endpoint = "/lol/match/v5/matches/{matchId}";
        var path = $"/lol/match/v5/matches/{Uri.EscapeDataString(matchId)}";

        var body = await SendRawAsync(
            endpoint: Endpoint,
            baseUrl: RiotRegions.RegionalBaseUrl(regionalRoute),
            path: path,
            priority: priority,
            cancellationToken: cancellationToken).ConfigureAwait(false);

        var match = Parse<MatchDto>(body, Endpoint);

        // A payload that parses into something unusable is caught here rather
        // than by a foreign key three layers down. The desktop validates this
        // boundary with a schema for the same reason: a changed or truncated
        // response should fail where it arrived, not corrupt a table quietly.
        if (string.IsNullOrEmpty(match.Metadata?.MatchId) || match.Info?.Participants is not { Count: > 0 })
        {
            throw new RiotApiException($"Riot returned a match with no id or no participants ({matchId})", 0);
        }

        return new RawMatch(match, body);
    }

    /// <summary>Every ladder this account has an entry on. An unranked account has none.</summary>
    public Task<List<LeagueEntryDto>> GetLeagueEntriesAsync(
        string platform,
        string puuid,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        // Riot removed the by-summoner (encryptedSummonerId) variant; by-puuid
        // is the supported path.
        var path = $"/lol/league/v4/entries/by-puuid/{Uri.EscapeDataString(puuid)}";

        return SendAsync<List<LeagueEntryDto>>(
            endpoint: "/lol/league/v4/entries/by-puuid/{puuid}",
            baseUrl: RiotRegions.PlatformBaseUrl(platform),
            path: path,
            priority: priority,
            cancellationToken: cancellationToken);
    }

    /// <summary>Mastery for every champion this account has played.</summary>
    public Task<List<ChampionMasteryDto>> GetChampionMasteryAsync(
        string platform,
        string puuid,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        var path = $"/lol/champion-mastery/v4/champion-masteries/by-puuid/{Uri.EscapeDataString(puuid)}";

        return SendAsync<List<ChampionMasteryDto>>(
            endpoint: "/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}",
            baseUrl: RiotRegions.PlatformBaseUrl(platform),
            path: path,
            priority: priority,
            cancellationToken: cancellationToken);
    }

    /// <summary>Profile icon and level. Cosmetic, and fetched alongside rank rather than alone.</summary>
    public Task<SummonerDto> GetSummonerAsync(
        string platform,
        string puuid,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        var path = $"/lol/summoner/v4/summoners/by-puuid/{Uri.EscapeDataString(puuid)}";

        return SendAsync<SummonerDto>(
            endpoint: "/lol/summoner/v4/summoners/by-puuid/{puuid}",
            baseUrl: RiotRegions.PlatformBaseUrl(platform),
            path: path,
            priority: priority,
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// One request, through the queue, with Riot's failures turned into ours.
    ///
    /// Deserialisation happens after the queue rather than inside it. The pump
    /// dispatches serially, so anything done inside the scheduled closure sits
    /// on the critical path of every later request — the desktop learned this
    /// with 200 KB match payloads, and the shape is worth keeping before the
    /// payloads that taught it arrive in Phase 2.
    /// </summary>
    private async Task<T> SendAsync<T>(
        string endpoint,
        Uri baseUrl,
        string path,
        RiotRequestPriority priority,
        CancellationToken cancellationToken)
    {
        var body = await SendRawAsync(endpoint, baseUrl, path, priority, cancellationToken)
            .ConfigureAwait(false);

        return Parse<T>(body, endpoint);
    }

    /// <summary>Deserialisation, in one place and off the pump's critical path.</summary>
    private static T Parse<T>(string body, string endpoint)
    {
        var parsed = JsonSerializer.Deserialize<T>(body, Json);
        if (parsed is null)
        {
            throw new RiotApiException($"Riot returned an empty body for {endpoint}", 0);
        }

        return parsed;
    }

    /// <summary>The request itself, answering with the response text unparsed.</summary>
    private async Task<string> SendRawAsync(
        string endpoint,
        Uri baseUrl,
        string path,
        RiotRequestPriority priority,
        CancellationToken cancellationToken)
    {
        return await _limiter.ScheduleAsync(
            async ct =>
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(baseUrl, path));
                request.Headers.Add("X-Riot-Token", _apiKey);

                // A client per call rather than one held for the life of the
                // process: the factory pools and rotates handlers, and a
                // singleton clutching one would pin its DNS forever.
                var http = _httpFactory.CreateClient(HttpClientName);
                using var response = await http.SendAsync(request, ct).ConfigureAwait(false);

                if (!response.IsSuccessStatusCode)
                {
                    throw await DescribeFailureAsync(response, endpoint, ct).ConfigureAwait(false);
                }

                return await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            },
            priority,
            cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Turns a non-2xx into the exception the limiter knows how to act on.
    ///
    /// The one subtlety is the 400. Riot answers "Exception decrypting &lt;puuid&gt;"
    /// when it is handed a puuid encrypted under a key we no longer hold, and
    /// that single case is repairable without anybody's help: re-resolve the
    /// account from its Riot ID and write the new puuid over the old. Every
    /// other 400 is a bug in this code.
    ///
    /// The body is classified and dropped rather than kept. That message embeds
    /// the puuid, and a log line is not the place for one.
    /// </summary>
    private async Task<RiotApiException> DescribeFailureAsync(
        HttpResponseMessage response,
        string endpoint,
        CancellationToken cancellationToken)
    {
        var status = (int)response.StatusCode;

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return new RiotApiException($"Riot has no record of that ({endpoint})", 404);
        }

        var retryAfter = response.Headers.RetryAfter?.Delta
            ?? (response.Headers.RetryAfter?.Date is { } at ? at - DateTimeOffset.UtcNow : null);

        var staleIdentity = false;
        if (status == 400)
        {
            try
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                staleIdentity = body.Contains("decrypt", StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException)
            {
                // A body that will not read is not a reason to replace the
                // caller's HTTP error with a plumbing one. The 400 is the
                // finding; this only labels it.
                _log.LogDebug(ex, "Could not read the body of a 400 from {Endpoint}", endpoint);
            }
        }

        return new RiotApiException($"Riot API error {status} for {endpoint}", status, retryAfter, staleIdentity);
    }
}
