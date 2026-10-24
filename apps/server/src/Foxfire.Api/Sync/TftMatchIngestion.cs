using System.Text.Json;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>
/// A TFT game, as Foxfire stores one: a <see cref="Match"/> like League's, and
/// a <see cref="TftParticipant"/> for each of the eight boards.
///
/// The same shape of work as <see cref="MatchIngestion"/> — one transaction per
/// game, a duplicate key read as another member's sync getting there first —
/// and the deduplication is <see cref="MatchIngestion.FilterUnstoredAsync"/>
/// itself, since a match id is unique across both games.
/// </summary>
public sealed class TftMatchIngestion(FoxfireDbContext db, TimeProvider time)
{
    /// <summary>Foxfire's own spelling of a board, camelCase and only what a row draws.</summary>
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Writes one game and its eight boards. False when somebody else's sync
    /// stored it first, which is success by another route.
    /// </summary>
    public async Task<bool> StoreAsync(RawTftMatch raw, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(raw);

        var (match, rawJson) = (raw.Match, raw.RawJson);
        var info = match.Info;
        var matchId = match.Metadata.MatchId;
        var participants = info.Participants ?? [];
        var queueId = info.QueueId ?? info.LegacyQueueId;

        var teams = TftPlacements.TeamPlacements(
            [.. participants.Select(p => new PlacedPlayer(p.Puuid, p.Placement, p.PartnerGroupId))]);

        var entity = new Match
        {
            MatchId = matchId,
            Game = Game.Tft,
            GameCreation = CreationOf(info),
            GameDuration = (int)Math.Round(info.GameLength, MidpointRounding.AwayFromZero),
            GameMode = "TFT",
            GameType = info.TftGameType,
            QueueId = queueId,
            PlatformId = PlatformOf(matchId),
            TftSetNumber = info.TftSetNumber,
            TftSetCoreName = info.TftSetCoreName,
            RawJson = rawJson,
            FetchedAt = time.GetUtcNow()
        };

        db.Matches.Add(entity);

        foreach (var participant in participants)
        {
            db.TftParticipants.Add(Project(
                matchId,
                participant,
                teams.TryGetValue(participant.Puuid, out var team) ? team : null,
                info.GameLength));
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            Forget(entity);
            if (await db.Matches.AsNoTracking().AnyAsync(m => m.MatchId == matchId, cancellationToken)) return false;
            throw;
        }
    }

    /// <summary>
    /// When the lobby was created, in the units every other time here is in.
    ///
    /// Riot added <c>gameCreation</c> to TFT later than to League. Without it, the
    /// creation is worked back from the end and the length — close enough to sit
    /// a game among readings the right way round, which is all it is used for.
    /// </summary>
    internal static long CreationOf(TftMatchInfoDto info) =>
        info.GameCreation is { } creation and > 0
            ? creation
            : info.GameDatetime - (long)Math.Round(info.GameLength * 1000, MidpointRounding.AwayFromZero);

    /// <summary>The platform half of an id: NA1 from NA1_5312345678.</summary>
    internal static string? PlatformOf(string matchId)
    {
        var underscore = matchId.IndexOf('_', StringComparison.Ordinal);
        return underscore > 0 ? matchId[..underscore] : null;
    }

    private void Forget(Match match)
    {
        foreach (var entry in db.ChangeTracker.Entries<TftParticipant>()
                     .Where(e => e.Entity.MatchId == match.MatchId)
                     .ToList())
        {
            entry.State = EntityState.Detached;
        }

        db.Entry(match).State = EntityState.Detached;
    }

    private static TftParticipant Project(string matchId, TftParticipantDto p, int? teamPlacement, double gameLength) =>
        new()
        {
            MatchId = matchId,
            Puuid = p.Puuid,
            GameName = p.RiotIdGameName,
            TagLine = p.RiotIdTagline,
            Placement = p.Placement,
            TeamPlacement = teamPlacement,
            PartnerGroupId = p.PartnerGroupId,
            Level = p.Level,
            LastRound = p.LastRound,
            // Where the game is placed among rank readings. A board Riot sent
            // without one lasted the lobby as far as anybody can tell — stored
            // as 0 it would place the game at its own start.
            TimeEliminated = p.TimeEliminated ?? gameLength,
            PlayersEliminated = p.PlayersEliminated,
            TotalDamageToPlayers = p.TotalDamageToPlayers,
            GoldLeft = p.GoldLeft,

            // Riot's own top-four flag when it sent one; the placement says the
            // same when it did not.
            Win = p.Win ?? p.Placement <= 4,

            TraitsJson = JsonSerializer.Serialize(
                (p.Traits ?? []).Select(t => new TftTraitRow(t.Name, t.NumUnits, t.Style, t.TierCurrent, t.TierTotal)),
                Json),
            UnitsJson = JsonSerializer.Serialize(
                (p.Units ?? []).Select(u => new TftUnitRow(u.CharacterId, u.Tier, u.Rarity, [.. u.ItemNames ?? []])),
                Json),
            AugmentsJson = p.Augments is { Count: > 0 } augments ? JsonSerializer.Serialize(augments, Json) : null
        };
}

/// <summary>A trait as Foxfire stores and serves it: @foxfire/core's TftTrait.</summary>
public sealed record TftTraitRow(string Name, int NumUnits, int Style, int TierCurrent, int TierTotal);

/// <summary>A unit as Foxfire stores and serves it: @foxfire/core's TftUnit.</summary>
public sealed record TftUnitRow(string CharacterId, int Tier, int Rarity, IReadOnlyList<string> Items);
