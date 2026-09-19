using Foxfire.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One reading of somebody's rank, kept forever.
///
/// Rank used to exist only as a current value per queue, upserted in place, so
/// every refresh destroyed the previous one and no history survived. This table
/// is append-only instead, and everything about LP is derived from pairs of
/// rows in it: the graph plots them, and <see cref="MatchRank"/> records what a
/// game between two of them was worth.
/// </summary>
public sealed class RankSnapshot
{
    /// <summary>
    /// An identity column rather than a Guid, because this one is read in order.
    ///
    /// Two readings can share a millisecond — a hand-entered one stamped at a
    /// game's end time landing beside an observed one — and attribution walks
    /// adjacent pairs, so which of them comes first changes the answer. SQL
    /// Server's sort is not stable and its ordering of uniqueidentifier is not
    /// byte order, so a Guid tiebreak would be both arbitrary and liable to
    /// differ between runs. Insertion order is the tiebreak the desktop uses,
    /// and it makes (account, queue, capturedAt, id) genuinely ordered.
    /// </summary>
    public long Id { get; set; }

    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    /// <summary>Riot's queue name, e.g. RANKED_SOLO_5x5.</summary>
    public required string QueueType { get; set; }

    public string? Tier { get; set; }

    /// <summary>The division. Riot calls it the rank, which is why the column is named for it.</summary>
    public string? Division { get; set; }

    public int? LeaguePoints { get; set; }
    public int? Wins { get; set; }
    public int? Losses { get; set; }

    /// <summary>
    /// Tier, division and LP folded onto one continuous number, stamped on write.
    ///
    /// Stored rather than recomputed so a graph never has to, and so a row keeps
    /// the answer the ladder maths gave at the time. Null when the reading was
    /// of an unranked account, which is why an interval touching one is never
    /// attributed.
    /// </summary>
    public int? LadderPosition { get; set; }

    /// <summary>
    /// Where the reading came from: `lcu` from a running League client, `league_v4`
    /// from Riot's API, or `manual` when somebody typed it.
    /// </summary>
    public required string Source { get; set; }

    /// <summary>
    /// Epoch milliseconds, not a datetime, and that is deliberate.
    ///
    /// This column is compared directly against <see cref="Match.GameCreation"/>
    /// to decide which games fall between two readings. Matching units keeps
    /// that predicate index-friendly instead of wrapping it in a date function,
    /// and keeps the boundary arithmetic identical to the desktop's.
    /// </summary>
    public long CapturedAt { get; set; }

    /// <summary>
    /// The game this reading describes, on a manual edit. Null on every observed one.
    ///
    /// Hand-entered LP is stored as a reading rather than as an attribution, on
    /// purpose: a reading written at a game's end time splits an ambiguous run
    /// into single-game intervals, so the LP figure, the promotion crest, the
    /// milestones and the graph all fall out of the machinery that already
    /// exists — and replaying attribution recomputes the same answer every time,
    /// so nothing needs an "is manual, leave it alone" guard.
    ///
    /// Carrying the link rather than inferring it from the timestamp is what
    /// makes clearing an edit a targeted delete and re-editing an update, so one
    /// game cannot accumulate several conflicting readings at one instant.
    /// </summary>
    public string? MatchId { get; set; }
    public Match? Match { get; set; }

    /// <summary>The shape the attribution rule takes as input.</summary>
    public RankReading ToReading() =>
        new(
            RankedQueues.FromRiotName(QueueType) ?? RankedQueue.SoloDuo,
            Tier,
            Division,
            LeaguePoints,
            Wins,
            Losses,
            LadderPosition,
            Source,
            CapturedAt);
}

internal sealed class RankSnapshotConfiguration : IEntityTypeConfiguration<RankSnapshot>
{
    public void Configure(EntityTypeBuilder<RankSnapshot> builder)
    {
        builder.HasKey(r => r.Id);
        builder.Property(r => r.QueueType).HasMaxLength(32);
        builder.Property(r => r.Tier).HasMaxLength(16);
        builder.Property(r => r.Division).HasMaxLength(4);
        builder.Property(r => r.Source).HasMaxLength(16).IsRequired();
        builder.Property(r => r.MatchId).HasMaxLength(32);

        builder.HasOne(r => r.RiotAccount)
            .WithMany()
            .HasForeignKey(r => r.RiotAccountId)
            .OnDelete(DeleteBehavior.Cascade);

        // A manual edit names the game it describes. Cascade would be wrong
        // here and is not merely unnecessary: SQL Server refuses a second
        // cascade path into this table anyway, since the account already has
        // one, so deleting a match clears the link and leaves the reading.
        builder.HasOne(r => r.Match)
            .WithMany()
            .HasForeignKey(r => r.MatchId)
            .OnDelete(DeleteBehavior.ClientSetNull);

        // Every read walks one account's readings for one queue in time
        // order. This is the index attribution lives on, and Id is on the
        // end of it because the walk is over adjacent pairs: two readings
        // sharing a millisecond have to come back in the same order every
        // time, or the pair between them changes.
        builder.HasIndex(r => new { r.RiotAccountId, r.QueueType, r.CapturedAt, r.Id });

        // Clearing a manual edit is a targeted delete by match.
        builder.HasIndex(r => r.MatchId);
    }
}

/// <summary>
/// What one game was worth.
///
/// Derived, never authoritative: a row exists only when exactly one ranked game
/// sat between two readings, so every one of these is a measurement rather than
/// an estimate spread across several games. Recomputed on every attribution
/// pass, which is why writing it is an upsert and why deleting the table would
/// cost nothing but a pass.
/// </summary>
public sealed class MatchRank
{
    public required string MatchId { get; set; }
    public Match Match { get; set; } = null!;

    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    public required string QueueType { get; set; }

    public string? TierBefore { get; set; }
    public string? DivisionBefore { get; set; }
    public int? LpBefore { get; set; }

    public string? TierAfter { get; set; }
    public string? DivisionAfter { get; set; }
    public int? LpAfter { get; set; }

    /// <summary>
    /// A difference of ladder positions rather than of raw LP.
    ///
    /// Raw LP wraps back to near zero across a division boundary, so Gold III 95
    /// to Gold II 12 would read as −83 for what was a 17 point win.
    /// </summary>
    public int LpDelta { get; set; }

    public bool IsPromotion { get; set; }
    public bool IsDemotion { get; set; }
}

internal sealed class MatchRankConfiguration : IEntityTypeConfiguration<MatchRank>
{
    public void Configure(EntityTypeBuilder<MatchRank> builder)
    {
        builder.HasKey(r => new { r.MatchId, r.RiotAccountId });
        builder.Property(r => r.MatchId).HasMaxLength(32);
        builder.Property(r => r.QueueType).HasMaxLength(32);
        builder.Property(r => r.TierBefore).HasMaxLength(16);
        builder.Property(r => r.DivisionBefore).HasMaxLength(4);
        builder.Property(r => r.TierAfter).HasMaxLength(16);
        builder.Property(r => r.DivisionAfter).HasMaxLength(4);

        builder.HasOne(r => r.Match)
            .WithMany()
            .HasForeignKey(r => r.MatchId)
            .OnDelete(DeleteBehavior.Cascade);

        // ClientSetNull rather than Cascade: SQL Server allows only one
        // cascade path between a pair of tables, and the match already has
        // it. Deleting an account is rare and goes through EF, which clears
        // these first; the rows are derived and a lost one costs an
        // attribution pass.
        builder.HasOne(r => r.RiotAccount)
            .WithMany()
            .HasForeignKey(r => r.RiotAccountId)
            .OnDelete(DeleteBehavior.ClientSetNull);
    }
}

/// <summary>
/// A ranked season boundary, entered by hand.
///
/// Riot publishes no way to ask which season is current: the static season list
/// stopped in 2019, ranked entries carry no season field, and match-v5 dropped
/// the id match-v4 used to send. The calendar is not a stand-in either — 2026
/// opened on 8 January, and a preseason can run into February — so a hard
/// 1 January cut would misfile games either side of it every year with no way
/// to correct it.
///
/// A season runs from its own start until the next one starts. The newest row is
/// open-ended forwards, so a missing boundary cannot cut the current season
/// short, and the oldest is open-ended backwards, so no game falls outside every
/// season. Gaps and overlaps are impossible to express.
///
/// Admin-only to write: one wrong <see cref="ResetsRank"/> silently rewrites
/// every member's LP history, because attribution skips reset boundaries.
/// </summary>
public sealed class RankedSeason
{
    public int Id { get; set; }

    public required string Label { get; set; }

    /// <summary>
    /// Epoch milliseconds, the same units as a match and a reading, so scoping a
    /// query to a season needs no conversion. Unique: two seasons opening at the
    /// same instant has no meaning and would make the ordering ambiguous.
    /// </summary>
    public long StartsAt { get; set; }

    /// <summary>
    /// Labelled distinctly in the pickers. A preseason still catches games —
    /// rank carries into it, so those games belong to a period like any other
    /// rather than vanishing from every view.
    /// </summary>
    public bool IsPreseason { get; set; }

    /// <summary>
    /// Whether the ladder actually emptied when this season opened.
    ///
    /// This, and not the boundary itself, is what stops a reset being attributed
    /// to whichever game happens to sit beside it as a two-thousand point loss.
    /// The two are not the same: a season that carries rank forward must keep
    /// attributing across its own start, and Riot has reset mid-year without a
    /// season boundary at all.
    /// </summary>
    public bool ResetsRank { get; set; }

    public Season ToDomain() => new(Id, Label, StartsAt, IsPreseason, ResetsRank);
}

internal sealed class RankedSeasonConfiguration : IEntityTypeConfiguration<RankedSeason>
{
    public void Configure(EntityTypeBuilder<RankedSeason> builder)
    {
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Label).HasMaxLength(64).IsRequired();

        // Two seasons opening at the same instant has no meaning and would
        // make the ordering — which is the whole of how a season is read —
        // ambiguous.
        builder.HasIndex(s => s.StartsAt).IsUnique();
    }
}
