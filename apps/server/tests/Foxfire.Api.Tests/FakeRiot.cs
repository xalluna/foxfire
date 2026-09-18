using System.Net;
using System.Text;
using System.Text.Json;
using Foxfire.Riot;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Riot, as far as the server can tell.
///
/// Substituted at the HttpMessageHandler rather than by replacing RiotClient,
/// deliberately: everything between the call site and the socket is what these
/// tests are actually about — the priority queue, the sliding windows, the JSON
/// contract, and the classification of a 400 as a stale identity rather than a
/// bug. A fake client would replace all of it with an assumption that it works.
///
/// It also records every path it was asked for, which is how the dedup tests
/// assert the interesting thing: not that the second account has the games, but
/// that fetching them cost nothing.
/// </summary>
public sealed class FakeRiot
{
    private readonly Lock _gate = new();
    private readonly List<string> _requests = [];
    private readonly Dictionary<string, List<string>> _matchIds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _matches = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _leagueEntries = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _accounts = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _undecryptable = new(StringComparer.Ordinal);

    /// <summary>Every path asked for, in order, including the query string.</summary>
    public IReadOnlyList<string> Requests
    {
        get { lock (_gate) return [.. _requests]; }
    }

    /// <summary>How many times a match payload was fetched. Zero is the interesting answer.</summary>
    public int MatchFetchCount(string matchId)
    {
        lock (_gate) return _requests.Count(r => r.Contains($"/matches/{matchId}", StringComparison.Ordinal));
    }

    public FakeRiot WithMatchIds(string puuid, params string[] matchIds)
    {
        lock (_gate) _matchIds[puuid] = [.. matchIds];
        return this;
    }

    public FakeRiot WithMatch(string matchId, string rawJson)
    {
        lock (_gate) _matches[matchId] = rawJson;
        return this;
    }

    public FakeRiot WithLeagueEntries(string puuid, string json)
    {
        lock (_gate) _leagueEntries[puuid] = json;
        return this;
    }

    /// <summary>What account-v1 answers for a Riot ID. This is what a re-key resolves through.</summary>
    public FakeRiot WithAccount(string gameName, string tagLine, string puuid)
    {
        var json = JsonSerializer.Serialize(new { puuid, gameName, tagLine });
        lock (_gate) _accounts[$"{gameName}/{tagLine}"] = json;
        return this;
    }

    /// <summary>
    /// A puuid Riot will no longer decrypt — what every stored puuid looks like
    /// after the server's API key is replaced.
    /// </summary>
    public FakeRiot WithDeadPuuid(string puuid)
    {
        lock (_gate) _undecryptable.Add(puuid);
        return this;
    }

    public HttpResponseMessage Respond(HttpRequestMessage request)
    {
        var uri = request.RequestUri!;
        var path = uri.PathAndQuery;

        lock (_gate) _requests.Add(path);

        // Checked before anything else, because this is how Riot behaves: the
        // puuid is undecryptable whatever you were trying to do with it.
        lock (_gate)
        {
            foreach (var dead in _undecryptable)
            {
                if (path.Contains(dead, StringComparison.Ordinal))
                {
                    return Json(
                        HttpStatusCode.BadRequest,
                        // Concatenated rather than written as a raw literal:
                        // the body closes on two braces, which an interpolated
                        // one reads as its own delimiter.
                        "{\"status\":{\"message\":\"Exception decrypting "
                        + dead
                        + "\",\"status_code\":400}}");
                }
            }
        }

        if (path.StartsWith("/lol/status/v4", StringComparison.Ordinal))
        {
            return Json(HttpStatusCode.OK, """{"id":"NA1","name":"North America"}""");
        }

        if (path.StartsWith("/riot/account/v1/accounts/by-riot-id/", StringComparison.Ordinal))
        {
            var key = Uri.UnescapeDataString(path["/riot/account/v1/accounts/by-riot-id/".Length..]);
            lock (_gate)
            {
                return _accounts.TryGetValue(key, out var account)
                    ? Json(HttpStatusCode.OK, account)
                    : NotFound();
            }
        }

        if (path.StartsWith("/lol/match/v5/matches/by-puuid/", StringComparison.Ordinal))
        {
            var puuid = Uri.UnescapeDataString(
                path["/lol/match/v5/matches/by-puuid/".Length..path.IndexOf("/ids", StringComparison.Ordinal)]);

            var start = QueryValue(uri.Query, "start", 0);
            var count = QueryValue(uri.Query, "count", 100);

            lock (_gate)
            {
                var ids = _matchIds.TryGetValue(puuid, out var all) ? all : [];
                var page = ids.Skip(start).Take(count);
                return Json(HttpStatusCode.OK, JsonSerializer.Serialize(page));
            }
        }

        if (path.StartsWith("/lol/match/v5/matches/", StringComparison.Ordinal))
        {
            var matchId = Uri.UnescapeDataString(path["/lol/match/v5/matches/".Length..]);
            lock (_gate)
            {
                return _matches.TryGetValue(matchId, out var raw)
                    ? Json(HttpStatusCode.OK, raw)
                    : NotFound();
            }
        }

        if (path.StartsWith("/lol/league/v4/entries/by-puuid/", StringComparison.Ordinal))
        {
            var puuid = Uri.UnescapeDataString(path["/lol/league/v4/entries/by-puuid/".Length..]);
            lock (_gate)
            {
                return Json(
                    HttpStatusCode.OK,
                    _leagueEntries.TryGetValue(puuid, out var entries) ? entries : "[]");
            }
        }

        if (path.StartsWith("/lol/champion-mastery/v4/", StringComparison.Ordinal))
        {
            return Json(HttpStatusCode.OK, "[]");
        }

        return NotFound();
    }

    /// <summary>One number out of a query string, without pulling in a parser for it.</summary>
    private static int QueryValue(string query, string name, int fallback)
    {
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var split = pair.Split('=', 2);
            if (split.Length == 2 && split[0] == name && int.TryParse(split[1], out var value)) return value;
        }

        return fallback;
    }

    private static HttpResponseMessage NotFound() =>
        Json(HttpStatusCode.NotFound, """{"status":{"message":"Data not found","status_code":404}}""");

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    /// <summary>
    /// A server whose Riot is this one.
    ///
    /// Its own host rather than the shared fixture's, so each test gets a fresh
    /// rate limiter and a fresh set of singletons. It shares the database, which
    /// is the point — the schema and its migrations are the real ones.
    /// </summary>
    public WebApplicationFactory<Program> Host(WebApplicationFactory<Program> parent) =>
        parent.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
                services
                    .AddHttpClient(RiotClient.HttpClientName)
                    .ConfigurePrimaryHttpMessageHandler(() => new StubHandler(this))));

    private sealed class StubHandler(FakeRiot riot) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(riot.Respond(request));
    }
}

/// <summary>Match payloads shaped the way match-v5 shapes them.</summary>
public static class MatchPayloads
{
    /// <summary>
    /// A full ten-player game, with <paramref name="puuids"/> filling the first
    /// slots and strangers filling the rest.
    ///
    /// Ten participants rather than one, because that is the number that makes
    /// dedup worth anything: the row a second member's sync finds already stored
    /// is the same row, and the participant that proves they were in it is
    /// already in it.
    /// </summary>
    public static string TenPlayerGame(
        string matchId,
        long gameCreation,
        int queueId,
        IReadOnlyList<string> puuids,
        bool remake = false,
        bool win = true)
    {
        var roster = Enumerable.Range(0, 10)
            .Select(i => i < puuids.Count ? puuids[i] : $"stranger-{matchId}-{i}")
            .ToList();

        var participants = new List<object>();

        for (var i = 0; i < 10; i++)
        {
            var puuid = roster[i];

            participants.Add(new
            {
                puuid,
                riotIdGameName = $"Player{i}",
                riotIdTagline = "NA1",
                teamId = i < 5 ? 100 : 200,
                win = i < 5 ? win : !win,
                championId = 100 + i,
                championName = $"Champion{i}",
                champLevel = 16,
                kills = i,
                deaths = 3,
                assists = 7,
                goldEarned = 12_000 + i,
                totalMinionsKilled = 180,
                neutralMinionsKilled = 20,
                totalDamageDealtToChampions = 25_000 + i,
                totalDamageTaken = 20_000,
                item0 = 3153,
                item1 = 3006,
                item2 = 6672,
                item3 = 3031,
                item4 = 3072,
                item5 = 0,
                item6 = 3363,
                summoner1Id = 4,
                summoner2Id = 14,
                teamPosition = "MIDDLE",
                largestMultiKill = 2,
                roleBoundItem = 0,
                gameEndedInEarlySurrender = remake,
                perks = new
                {
                    statPerks = new { defense = 5002, flex = 5008, offense = 5005 },
                    styles = Array.Empty<object>()
                }
            });
        }

        return JsonSerializer.Serialize(new
        {
            metadata = new
            {
                matchId,
                participants = roster
            },
            info = new
            {
                gameCreation,
                gameDuration = 1669,
                gameMode = "CLASSIC",
                gameType = "MATCHED_GAME",
                queueId,
                platformId = "NA1",
                participants
            }
        });
    }
}
