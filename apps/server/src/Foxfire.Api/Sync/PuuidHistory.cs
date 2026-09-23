using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>What moving one player id's stored games onto another touched.</summary>
/// <param name="Matches">Payloads rewritten.</param>
/// <param name="Participants">Participant rows moved.</param>
/// <param name="Collisions">
/// Games left exactly as they were, because both ids already appear in them.
/// </param>
public sealed record PuuidMove(int Matches, int Participants, int Collisions);

/// <summary>
/// Moving stored games from one player id to another.
///
/// Two things need this and it is the same operation both times: a Riot key
/// rotation, where every id an account has stored goes dead and is replaced by
/// the one Riot now answers for, and an import, where an account that could not
/// be resolved the first time finally is and its earlier games have to follow.
/// One implementation, so the payload and the participant row cannot be moved
/// by two rules that quietly disagree.
///
/// No transaction of its own. The caller owns one — a rotation moves the account
/// row in the same breath, an import files the mapping — and EF will not nest.
/// It is safe to run twice, though: a second pass finds nothing under the old id.
/// </summary>
public static class PuuidHistory
{
    /// <summary>
    /// Games in which both ids already appear.
    ///
    /// Only reachable from a half-applied earlier move, and moving one onto the
    /// other would collide on the participant key. What to do about one is the
    /// caller's — a rotation refuses, an import leaves them alone and says so.
    /// </summary>
    public static Task<List<string>> CollidingMatchesAsync(
        FoxfireDbContext db,
        string oldPuuid,
        string newPuuid,
        CancellationToken cancellationToken) =>
        db.MatchParticipants
            .Where(mine => mine.Puuid == oldPuuid
                && db.MatchParticipants.Any(theirs => theirs.MatchId == mine.MatchId && theirs.Puuid == newPuuid))
            .Select(mine => mine.MatchId)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Moves every game under <paramref name="oldPuuid"/> onto <paramref name="newPuuid"/>,
    /// payload and participant row together, skipping any game that would collide.
    ///
    /// The payload is rewritten by textual replacement. That looks crude and is
    /// exactly right: it is kept so future columns can be backfilled out of it,
    /// and a backfill reading a puuid that no longer matches the participant row
    /// beside it would write mismatched data. The old value appears in the
    /// metadata roster and in one participant block, and both should change.
    /// </summary>
    public static async Task<PuuidMove> MoveAsync(
        FoxfireDbContext db,
        string oldPuuid,
        string newPuuid,
        CancellationToken cancellationToken)
    {
        var colliding = await CollidingMatchesAsync(db, oldPuuid, newPuuid, cancellationToken);

        // Before the participant rows move, while the old puuid still selects
        // the matches to touch.
        var matches = await db.Matches
            .Where(m => !colliding.Contains(m.MatchId)
                && db.MatchParticipants.Any(p => p.MatchId == m.MatchId && p.Puuid == oldPuuid))
            .ExecuteUpdateAsync(
                s => s.SetProperty(m => m.RawJson, m => m.RawJson.Replace(oldPuuid, newPuuid)),
                cancellationToken);

        var participants = await db.MatchParticipants
            .Where(p => p.Puuid == oldPuuid && !colliding.Contains(p.MatchId))
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.Puuid, newPuuid), cancellationToken);

        return new PuuidMove(matches, participants, colliding.Count);
    }
}
