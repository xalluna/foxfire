using System.Text.Json;
using Foxfire.Api.Reads;
using Foxfire.Riot;

namespace Foxfire.Api.Endpoints;

/// <summary>Who somebody is, without tracking them.</summary>
public sealed record AdHocProfile(
    string Puuid,
    string GameName,
    string TagLine,
    int ProfileIconId,
    long SummonerLevel);

/// <summary>A player nobody on this server tracks, looked up live.</summary>
public sealed record AdHocSummonerResponse(
    AdHocProfile Profile,
    IReadOnlyList<LeagueEntryResponse> LeagueEntries,
    IReadOnlyList<MatchSummaryResponse> RecentMatches);

/// <summary>
/// Looking somebody up who is not on this server.
///
/// Deliberately writes nothing. No backfill, no cache table, no account row —
/// the only history a server keeps belongs to accounts somebody has claimed.
/// That is the desktop's rule and it matters more here, not less: a server that
/// quietly accumulated every player anybody had ever searched for would grow
/// without bound and would be storing data on people who never agreed to it.
///
/// The cost is that a search is thirteen Riot requests out of a budget shared by
/// everybody, which is why it runs at interactive priority and fetches ten games
/// rather than a page. Somebody is watching a spinner, and ten games is enough
/// to see who they are.
/// </summary>
public static class SearchEndpoints
{
    private const int AdHocMatchCount = 10;

    public static void MapSearchEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/search", SearchAsync).WithTags("Search").RequireAuthorization();
    }

    private static async Task<IResult> SearchAsync(
        string gameName,
        string tagLine,
        RiotClient riot,
        CancellationToken cancellationToken)
    {
        gameName = (gameName ?? "").Trim();
        tagLine = (tagLine ?? "").TrimStart('#').Trim();

        if (gameName.Length == 0 || tagLine.Length == 0)
        {
            return AuthEndpoints.Problem("invalid_riot_id", "A Riot ID is a name and a tag, like Alluna#NA1.");
        }

        var platform = RiotRegions.DefaultPlatform;
        var route = RiotRegions.DefaultRegionalRoute;

        RiotAccountDto account;
        try
        {
            account = await riot.GetAccountByRiotIdAsync(
                route, gameName, tagLine, RiotRequestPriority.Interactive, cancellationToken);
        }
        catch (RiotApiException ex) when (ex.Status == 404)
        {
            return AuthEndpoints.Problem(
                "riot_account_not_found",
                $"Riot has no account called {gameName}#{tagLine} in this region.",
                StatusCodes.Status404NotFound);
        }
        catch (RiotApiException ex) when (ex.IsKeyRejection)
        {
            return AuthEndpoints.Problem(
                "riot_key_rejected",
                "This server's Riot API key is not working. Its administrator needs to replace it.",
                StatusCodes.Status503ServiceUnavailable);
        }

        var summoner = await riot.GetSummonerAsync(
            platform, account.Puuid, RiotRequestPriority.Interactive, cancellationToken);

        var entries = await riot.GetLeagueEntriesAsync(
            platform, account.Puuid, RiotRequestPriority.Interactive, cancellationToken);

        var matchIds = await riot.GetMatchIdsAsync(
            route, account.Puuid, 0, AdHocMatchCount, RiotRequestPriority.Interactive, cancellationToken);

        List<MatchSummaryResponse> recent = [];

        foreach (var matchId in matchIds)
        {
            // Serially rather than in parallel, because the limiter dispatches
            // serially anyway — firing ten at once would only put ten items in
            // one queue slot's worth of time and make the failure of any one of
            // them harder to attribute.
            var raw = await riot.GetMatchAsync(route, matchId, RiotRequestPriority.Interactive, cancellationToken);

            var summary = Summarise(raw, account.Puuid);
            if (summary is not null) recent.Add(summary);
        }

        var now = DateTimeOffset.UtcNow;

        return Results.Ok(new AdHocSummonerResponse(
            new AdHocProfile(
                account.Puuid,
                account.GameName ?? gameName,
                account.TagLine ?? tagLine,
                summoner.ProfileIconId,
                summoner.SummonerLevel),
            [
                .. entries
                    .Where(e => Foxfire.Core.RankedQueues.FromRiotName(e.QueueType) is not null)
                    .Select(e => new LeagueEntryResponse(
                        e.QueueType, e.Tier, e.Division, e.LeaguePoints, e.Wins, e.Losses, now))
            ],
            recent));
    }

    /// <summary>
    /// One game as a match row, built from the payload rather than from a table.
    ///
    /// Mirrors what the stored query returns, so an ad-hoc result renders through
    /// exactly the same row as a tracked account's history. The two fields that
    /// cannot apply are the reason this is worth spelling out: LP is only ever
    /// derived for accounts with recorded readings, and search stores nothing, so
    /// an ad-hoc row has no rank and nothing for the editor to act on.
    /// </summary>
    private static MatchSummaryResponse? Summarise(RawMatch raw, string puuid)
    {
        var me = raw.Match.Info.Participants.FirstOrDefault(p => p.Puuid == puuid);
        if (me is null) return null;

        var team = raw.Match.Info.Participants.Where(p => p.TeamId == me.TeamId).ToList();

        return new MatchSummaryResponse(
            raw.Match.Metadata.MatchId,
            raw.Match.Info.GameCreation,
            raw.Match.Info.GameDuration,
            raw.Match.Info.GameMode,
            raw.Match.Info.QueueId,
            me.Win,
            me.ChampionId,
            me.ChampionName,
            me.ChampLevel,
            me.Kills,
            me.Deaths,
            me.Assists,
            me.Cs,
            me.GoldEarned,
            me.TotalDamageDealtToChampions,
            me.LargestMultiKill,
            me.Items,
            me.RoleBoundItem ?? 0,
            me.Summoner1Id,
            me.Summoner2Id,
            me.Perks.ValueKind == JsonValueKind.Undefined ? null : me.Perks,
            me.TeamPosition,
            team.Sum(p => p.Kills),
            team.Sum(p => p.TotalDamageDealtToChampions),
            me.GameEndedInEarlySurrender,
            Rank: null,
            HasManualRank: false);
    }
}
