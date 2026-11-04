namespace Foxfire.Core;

/// <summary>A TFT player, as far as team placement cares.</summary>
public sealed record PlacedPlayer(string Puuid, int Placement, int? PartnerGroupId);

/// <summary>
/// The arithmetic of a TFT game the server computes too.
///
/// A port of packages/core/src/rules/tft.ts, held to it by the cases in
/// fixtures/game-registry.json.
/// </summary>
public static class TftPlacements
{
    /// <summary>Double Up, which is placed by team.</summary>
    public const int DoubleUpQueueId = 1160;

    /// <summary>
    /// Each Double Up player's team placement, 1 to 4, by puuid.
    ///
    /// Teams are ranked by their best member's own placement, which is right
    /// whichever way Riot reports Double Up — partners sharing the team's place
    /// or holding their own — because in both the team that finished first
    /// holds the best number. Ties break on the group id, so the answer never
    /// depends on the order the lobby was read in. A player with no partner
    /// group has no team to place and is left out.
    /// </summary>
    public static IReadOnlyDictionary<string, int> TeamPlacements(IReadOnlyList<PlacedPlayer> players)
    {
        ArgumentNullException.ThrowIfNull(players);

        var order = players
            .Where(p => p.PartnerGroupId is not null)
            .GroupBy(p => p.PartnerGroupId!.Value)
            .Select(g => (Group: g.Key, Best: g.Min(p => p.Placement)))
            .OrderBy(t => t.Best)
            .ThenBy(t => t.Group)
            .Select((t, index) => (t.Group, Place: index + 1))
            .ToDictionary(t => t.Group, t => t.Place);

        Dictionary<string, int> placed = [];
        foreach (var p in players)
        {
            if (p.PartnerGroupId is { } group) placed[p.Puuid] = order[group];
        }

        return placed;
    }

    /// <summary>The place a ladder counts: the team's in Double Up, the player's own everywhere else.</summary>
    public static int Counted(int placement, int? teamPlacement, int? queueId) =>
        queueId == DoubleUpQueueId && teamPlacement is { } team ? team : placement;

    /// <summary>
    /// Where a TFT game is placed among rank readings: at its player's own
    /// elimination, not the lobby's end.
    ///
    /// TFT moves LP the moment somebody is knocked out, and the last player
    /// standing can be twenty minutes behind; placed at the lobby's end, a
    /// reading taken after an early exit lands before the game and hands its LP
    /// to the one before. Rounded half up, as JavaScript's Math.round does — see
    /// <see cref="Ladder"/> for why that matters.
    /// </summary>
    public static long GameEnd(long gameCreation, double? timeEliminatedSeconds, int gameDurationSeconds) =>
        gameCreation + (long)Math.Floor(((timeEliminatedSeconds ?? gameDurationSeconds) * 1000) + 0.5);
}
