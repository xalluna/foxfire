using Foxfire.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// A Riot account's current standing on one ladder.
///
/// Current value only — one row per account per queue, upserted in place. The
/// history lives in <see cref="RankSnapshot"/>, which exists precisely because
/// this table destroys the previous value on every refresh.
///
/// Kept anyway rather than derived from the newest reading, because the profile
/// card wants wins and losses and a fetch time, and reading those off the top of
/// an append-only table on every page load is a worse query for no benefit.
/// </summary>
public sealed class LeagueEntry
{
    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    public required string QueueType { get; set; }

    public RankTier? Tier { get; set; }

    /// <summary>The division. Riot calls it the rank.</summary>
    public RankDivision? Division { get; set; }

    public int? LeaguePoints { get; set; }
    public int? Wins { get; set; }
    public int? Losses { get; set; }

    /// <summary>Hyper Roll's colour, on its rated ladder, where tier, division and LP are null.</summary>
    public RatedTier? RatedTier { get; set; }

    /// <summary>Hyper Roll's rating, beside <see cref="RatedTier"/>.</summary>
    public int? RatedRating { get; set; }

    public DateTimeOffset FetchedAt { get; set; }
}

internal sealed class LeagueEntryConfiguration : IEntityTypeConfiguration<LeagueEntry>
{
    public void Configure(EntityTypeBuilder<LeagueEntry> builder)
    {
        builder.HasKey(l => new { l.RiotAccountId, l.QueueType });
        builder.Property(l => l.QueueType).HasMaxLength(32);
        builder.Property(l => l.Tier).HasConversion(RankConverters.Tier).HasMaxLength(16);
        builder.Property(l => l.Division).HasConversion(RankConverters.Division).HasMaxLength(4);
        builder.Property(l => l.RatedTier).HasConversion(RankConverters.RatedTier).HasMaxLength(16);

        builder.HasOne(l => l.RiotAccount)
            .WithMany()
            .HasForeignKey(l => l.RiotAccountId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// Riot's mastery figure for one champion on one account.
///
/// Lifetime and queue-agnostic, which is worth remembering when it sits next to
/// win rates that are neither: the mastery screen shows both, and only one of
/// them responds to the queue filter.
/// </summary>
public sealed class ChampionMastery
{
    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    public int ChampionId { get; set; }

    public int? ChampionPoints { get; set; }
    public int? ChampionLevel { get; set; }

    /// <summary>Epoch milliseconds, as Riot sends it.</summary>
    public long? LastPlayTime { get; set; }

    public DateTimeOffset FetchedAt { get; set; }
}

internal sealed class ChampionMasteryConfiguration : IEntityTypeConfiguration<ChampionMastery>
{
    public void Configure(EntityTypeBuilder<ChampionMastery> builder)
    {
        builder.HasKey(m => new { m.RiotAccountId, m.ChampionId });

        builder.HasOne(m => m.RiotAccount)
            .WithMany()
            .HasForeignKey(m => m.RiotAccountId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// How far through fetching an account's history in one game the server has got.
///
/// One row per Riot account per game: League's and TFT's histories are fetched
/// from different endpoints, backfill to their own targets and stop at their
/// own newest match, so one row could not say where either had got to. The
/// backfill is resumable because every match is
/// committed as it arrives and already-stored ones are skipped, so this is a
/// record of progress rather than a lock — losing it would cost a re-walk, not
/// correctness.
/// </summary>
public sealed class SyncState
{
    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    /// <summary>Whose history this is the progress of. League for every row from before TFT.</summary>
    public Game Game { get; set; }

    /// <summary>
    /// The newest match already stored, which is where a delta sync stops
    /// walking backwards.
    /// </summary>
    public string? MostRecentMatchId { get; set; }

    public bool BackfillComplete { get; set; }

    /// <summary>
    /// How many matches the first sync is trying to reach.
    ///
    /// Copied onto the row when the backfill starts rather than read live, so
    /// an admin lowering the server-wide setting does not retroactively declare
    /// a half-finished backfill complete.
    /// </summary>
    public int BackfillTarget { get; set; }

    public DateTimeOffset? LastFullSyncAt { get; set; }
    public DateTimeOffset? LastDeltaSyncAt { get; set; }
}

internal sealed class SyncStateConfiguration : IEntityTypeConfiguration<SyncState>
{
    public void Configure(EntityTypeBuilder<SyncState> builder)
    {
        builder.HasKey(s => new { s.RiotAccountId, s.Game });
        builder.Property(s => s.Game).HasConversion(GameConverters.Game).HasMaxLength(8);
        builder.Property(s => s.MostRecentMatchId).HasMaxLength(32);

        builder.HasOne(s => s.RiotAccount)
            .WithMany()
            .HasForeignKey(s => s.RiotAccountId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// A puuid an account used to have.
///
/// Riot encrypts a puuid against the API key that asked for it, so replacing the
/// key invalidates every puuid the server has ever stored — Riot answers a stale
/// one with a 400 saying it could not decrypt it, and the sync stops dead. The
/// recovery is to re-resolve each account from its Riot ID, which is the one
/// handle that survives a key change, and rewrite the stored history onto the
/// new puuid.
///
/// This is what that rewrite leaves behind. It is a record, not a lookup:
/// nothing joins through it, because the re-key rewrites the participant rows in
/// the same transaction and leaves no stale value to resolve. It exists so that
/// a puuid turning up later — in a log, a backup, a bug report — can be
/// attributed to the account it belonged to, and so "why did this row change"
/// has an answer.
/// </summary>
public sealed class RetiredPuuid
{
    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    public required string Puuid { get; set; }

    /// <summary>
    /// Which key it was encrypted under: the main one, or TFT's own when the
    /// server has one. Main for every row from before there could be two.
    /// </summary>
    public RiotKeyScope Scope { get; set; }

    public DateTimeOffset RetiredAt { get; set; }
}

internal sealed class RetiredPuuidConfiguration : IEntityTypeConfiguration<RetiredPuuid>
{
    public void Configure(EntityTypeBuilder<RetiredPuuid> builder)
    {
        builder.HasKey(r => new { r.RiotAccountId, r.Puuid });
        builder.Property(r => r.Puuid).HasMaxLength(78);
        builder.Property(r => r.Scope).HasConversion(GameConverters.Scope).HasMaxLength(8);

        builder.HasOne(r => r.RiotAccount)
            .WithMany()
            .HasForeignKey(r => r.RiotAccountId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// An account's puuid under a key other than the main one.
///
/// Riot encrypts a puuid per key, and ties a key to a product. A server whose
/// main key was registered for League alone needs a second key for TFT, and
/// under that key every player has a second puuid: TFT's history is fetched
/// with it, and its rows are keyed by it. <see cref="RiotAccount.Puuid"/> stays
/// the main key's.
///
/// A row exists only while the server has a TFT key of its own. Without one,
/// TFT is called with the main key and the main puuid is the TFT one too —
/// and taking a TFT key away moves TFT's rows back onto it and deletes this.
/// </summary>
public sealed class ScopedPuuid
{
    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    public RiotKeyScope Scope { get; set; }

    public required string Puuid { get; set; }

    public DateTimeOffset ResolvedAt { get; set; }
}

internal sealed class ScopedPuuidConfiguration : IEntityTypeConfiguration<ScopedPuuid>
{
    public void Configure(EntityTypeBuilder<ScopedPuuid> builder)
    {
        builder.HasKey(s => new { s.RiotAccountId, s.Scope });
        builder.Property(s => s.Scope).HasConversion(GameConverters.Scope).HasMaxLength(8);
        builder.Property(s => s.Puuid).HasMaxLength(78);

        // One player per puuid under a key, as RiotAccounts.Puuid is unique
        // under the main one.
        builder.HasIndex(s => new { s.Scope, s.Puuid }).IsUnique();

        builder.HasOne(s => s.RiotAccount)
            .WithMany()
            .HasForeignKey(s => s.RiotAccountId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
