using System.Text.Json;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>
/// Turning what Riot sent into rows, once per match for the whole server.
///
/// The desktop's equivalent is insertMatch in matches.repo, and the projection
/// is the same projection — the same columns, filled from the same fields, in
/// the same units. It has to be: the desktop's SQLite copy and this one are read
/// by the same renderer, so a difference here shows up as a match row that looks
/// wrong on one machine and right on another.
///
/// What differs is who else might be writing. On the desktop a match arrives
/// once, for the one person whose app fetched it. Here ten people can be on the
/// server and two of their syncs can reach the same game within milliseconds of
/// each other, so "already stored" is a race rather than a state — hence the
/// filter up front for the common case and the caught duplicate-key for the rest.
/// </summary>
public sealed class MatchIngestion(FoxfireDbContext db, TimeProvider time)
{
    /// <summary>
    /// Which of these the server has never seen.
    ///
    /// One query rather than the desktop's one-per-id: against SQL Server over a
    /// network, a hundred round trips to answer a hundred yes/no questions is the
    /// difference between a page of a backfill taking milliseconds and taking a
    /// noticeable pause.
    /// </summary>
    public async Task<IReadOnlyList<string>> FilterUnstoredAsync(
        IReadOnlyList<string> matchIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(matchIds);
        if (matchIds.Count == 0) return [];

        var known = await db.Matches
            .Where(m => matchIds.Contains(m.MatchId))
            .Select(m => m.MatchId)
            .ToListAsync(cancellationToken);

        var stored = known.ToHashSet(StringComparer.Ordinal);
        return [.. matchIds.Where(id => !stored.Contains(id))];
    }

    /// <summary>
    /// Stores a match and its participants, or reports that somebody else just did.
    ///
    /// Returns false for an already-stored match rather than throwing, because
    /// that is not a failure — it is the normal outcome of two members of the
    /// same premade syncing at once, and it means the row is there, which is all
    /// the caller wanted.
    /// </summary>
    public async Task<bool> StoreAsync(RawMatch raw, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(raw);

        var (match, rawJson) = (raw.Match, raw.RawJson);
        var matchId = match.Metadata.MatchId;

        var entity = new Match
        {
            MatchId = matchId,
            GameCreation = match.Info.GameCreation,
            GameDuration = match.Info.GameDuration,
            GameMode = match.Info.GameMode,
            GameType = match.Info.GameType,
            QueueId = match.Info.QueueId,
            PlatformId = match.Info.PlatformId,
            RawJson = rawJson,
            FetchedAt = time.GetUtcNow()
        };

        db.Matches.Add(entity);

        foreach (var participant in match.Info.Participants)
        {
            db.MatchParticipants.Add(Project(matchId, participant));
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            // Detach what this one staged either way, so the context is usable
            // for the next match rather than carrying a dead insert into every
            // later SaveChanges.
            Forget(entity);

            // A duplicate key here is somebody else's sync getting there first,
            // which is success by another route. Anything else is a real failure
            // and belongs to the caller. Asking the database which it was beats
            // matching on a provider-specific error number.
            if (await ExistsAsync(matchId, cancellationToken)) return false;
            throw;
        }
    }

    private async Task<bool> ExistsAsync(string matchId, CancellationToken cancellationToken) =>
        await db.Matches.AsNoTracking().AnyAsync(m => m.MatchId == matchId, cancellationToken);

    private void Forget(Match match)
    {
        foreach (var entry in db.ChangeTracker.Entries<MatchParticipant>()
                     .Where(e => e.Entity.MatchId == match.MatchId)
                     .ToList())
        {
            entry.State = EntityState.Detached;
        }

        db.Entry(match).State = EntityState.Detached;
    }

    /// <summary>
    /// One participant row, projected exactly as the desktop projects it.
    ///
    /// Items are a JSON array of the seven slots in slot order, and cs is
    /// minions plus monsters summed on the way in — both because that is what
    /// the renderer reads, and the renderer is shared.
    /// </summary>
    private static MatchParticipant Project(string matchId, MatchParticipantDto p) =>
        new()
        {
            MatchId = matchId,
            Puuid = p.Puuid,
            GameName = p.RiotIdGameName,
            TagLine = p.RiotIdTagline,
            TeamId = p.TeamId,
            Win = p.Win,
            ChampionId = p.ChampionId,
            ChampionName = p.ChampionName,
            ChampLevel = p.ChampLevel,
            Kills = p.Kills,
            Deaths = p.Deaths,
            Assists = p.Assists,
            GoldEarned = p.GoldEarned,
            Cs = p.Cs,
            DamageDealtToChampions = p.TotalDamageDealtToChampions,
            DamageTaken = p.TotalDamageTaken,
            ItemsJson = JsonSerializer.Serialize(p.Items),
            Summoner1Id = p.Summoner1Id,
            Summoner2Id = p.Summoner2Id,

            // The element as Riot sent it. Re-serialising a parsed rune tree
            // would be a lossy round trip for no gain — nothing here reads
            // inside it.
            PerksJson = p.Perks.ValueKind == JsonValueKind.Undefined ? null : p.Perks.GetRawText(),

            TeamPosition = p.TeamPosition,
            LargestMultiKill = p.LargestMultiKill,
            GameEndedInEarlySurrender = p.GameEndedInEarlySurrender,

            // Zero rather than null for a match played before the role quest
            // existed: the column means "no reward", and the renderer draws a
            // missing item for zero already.
            RoleBoundItem = p.RoleBoundItem ?? 0
        };
}
