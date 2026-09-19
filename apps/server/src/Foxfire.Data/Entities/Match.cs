using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One game, stored once for everybody on the server.
///
/// Matches are shared rather than owned. Ten people play a game and any number
/// of them may be on this server; the row is the same row, and
/// <see cref="MatchParticipant"/> carries who was in it. That is what makes the
/// storage cost of a community sublinear in its size, and it is why a friend
/// linking their account often costs almost no Riot requests — most of their
/// recent games are already here.
/// </summary>
public sealed class Match
{
    /// <summary>Riot's own id, e.g. NA1_5312345678. Globally unique, so it is the key.</summary>
    public required string MatchId { get; set; }

    /// <summary>Epoch milliseconds. The same units as a rank reading, deliberately.</summary>
    public long GameCreation { get; set; }

    /// <summary>Seconds.</summary>
    public int GameDuration { get; set; }

    public string? GameMode { get; set; }
    public string? GameType { get; set; }

    /// <summary>Null when Riot did not say. 420 and 440 are the ranked ladders.</summary>
    public int? QueueId { get; set; }

    public string? PlatformId { get; set; }

    /// <summary>
    /// The whole match-v5 payload, exactly as Riot sent it.
    ///
    /// Load-bearing, not a debugging convenience. Three of the desktop's
    /// migrations add a new projected column and backfill it out of this with no
    /// Riot calls at all — multi-kills, remakes, the role-bound item — and on a
    /// server sharing one personal key the alternative is not slower, it is
    /// days. Adding a stat column should be a migration, not a re-fetch of every
    /// game the community has ever played.
    ///
    /// Roughly 100–200 KB each, uncompressed. A few thousand deduplicated
    /// matches is well under a gigabyte, and storage is the cheap resource here.
    /// </summary>
    public required string RawJson { get; set; }

    public DateTimeOffset FetchedAt { get; set; }

    public ICollection<MatchParticipant> Participants { get; } = [];
}

internal sealed class MatchConfiguration : IEntityTypeConfiguration<Match>
{
    public void Configure(EntityTypeBuilder<Match> builder)
    {
        builder.HasKey(m => m.MatchId);
        builder.Property(m => m.MatchId).HasMaxLength(32);
        builder.Property(m => m.GameMode).HasMaxLength(32);
        builder.Property(m => m.GameType).HasMaxLength(32);
        builder.Property(m => m.PlatformId).HasMaxLength(8);

        // nvarchar(max). A match payload is 100-200 KB of UTF-16 once SQL
        // Server has it, and there is no length short of max that would not
        // eventually truncate one.
        builder.Property(m => m.RawJson).IsRequired();

        // History pages walk backwards through time.
        builder.HasIndex(m => m.GameCreation);

        // For attribution, which looks up the ranked games between two
        // readings and has no player-shaped entry point to start from. The
        // match list and champion stats deliberately do NOT use it — both
        // start from a participant row and reach the match by key, which is
        // already the better plan.
        builder.HasIndex(m => m.QueueId);
    }
}

/// <summary>
/// One player's line in one game, projected out of the payload.
///
/// Every column here could be read back out of <see cref="Match.RawJson"/>, and
/// that is not a reason to drop them: the match list, the champion table and LP
/// attribution all filter and aggregate across thousands of these, and doing it
/// through JSON extraction would mean a scan per screen.
///
/// Unlike the desktop, this has no surrogate id. There the table carries an
/// autoincrementing key plus a unique constraint on (match, player); the key was
/// never used for anything, so the constraint is simply the key here.
/// </summary>
public sealed class MatchParticipant
{
    public required string MatchId { get; set; }
    public Match Match { get; set; } = null!;

    /// <summary>
    /// Riot's encrypted player id, under this server's API key.
    ///
    /// Rewritten for every row when the key changes — see the re-keying path —
    /// because a puuid encrypted under a key nobody holds any more is a value
    /// that matches nothing.
    /// </summary>
    public required string Puuid { get; set; }

    /// <summary>
    /// Who they were called at the time, when Riot said.
    ///
    /// Kept rather than joined to the account, because most participants are
    /// strangers with no account here — and because a name at the time of a game
    /// is worth more on an old match than whatever the name is now.
    /// </summary>
    public string? GameName { get; set; }
    public string? TagLine { get; set; }

    public int TeamId { get; set; }
    public bool Win { get; set; }

    public int ChampionId { get; set; }
    public string? ChampionName { get; set; }
    public int? ChampLevel { get; set; }

    public int? Kills { get; set; }
    public int? Deaths { get; set; }
    public int? Assists { get; set; }
    public int? GoldEarned { get; set; }

    /// <summary>Minions plus neutral monsters, summed on the way in.</summary>
    public int? Cs { get; set; }

    public int? DamageDealtToChampions { get; set; }
    public int? DamageTaken { get; set; }

    /// <summary>The six bought slots plus the trinket, as a JSON array.</summary>
    public string? ItemsJson { get; set; }

    /// <summary>
    /// The role quest reward, which is not an inventory slot.
    ///
    /// Riot reports it separately and it never appears among the item slots, so
    /// a bot-lane row used to show a finished build with no boots in it. Its own
    /// column rather than a seventh item, because items mean the slots.
    /// </summary>
    public int RoleBoundItem { get; set; }

    public int? Summoner1Id { get; set; }
    public int? Summoner2Id { get; set; }
    public string? PerksJson { get; set; }
    public string? TeamPosition { get; set; }
    public int? LargestMultiKill { get; set; }

    /// <summary>
    /// A remake: somebody failed to connect and the game was voided.
    ///
    /// It awards no LP and says nothing about how a champion performs, so it is
    /// excluded from champion win rates and from LP attribution. Three of them
    /// was enough to make the desktop's numbers disagree with op.gg.
    /// </summary>
    public bool GameEndedInEarlySurrender { get; set; }
}

internal sealed class MatchParticipantConfiguration : IEntityTypeConfiguration<MatchParticipant>
{
    public void Configure(EntityTypeBuilder<MatchParticipant> builder)
    {
        // The desktop carries a surrogate key here plus a unique constraint
        // on this pair. The key was never used for anything, so the
        // constraint is simply the key.
        builder.HasKey(p => new { p.MatchId, p.Puuid });

        builder.Property(p => p.MatchId).HasMaxLength(32);
        builder.Property(p => p.Puuid).HasMaxLength(78);
        builder.Property(p => p.GameName).HasMaxLength(64);
        builder.Property(p => p.TagLine).HasMaxLength(16);
        builder.Property(p => p.ChampionName).HasMaxLength(32);
        builder.Property(p => p.TeamPosition).HasMaxLength(16);
        builder.Property(p => p.ItemsJson).HasMaxLength(256);
        builder.Property(p => p.PerksJson).HasMaxLength(2048);

        builder.HasOne(p => p.Match)
            .WithMany(m => m.Participants)
            .HasForeignKey(p => p.MatchId)
            .OnDelete(DeleteBehavior.Cascade);

        // Every screen that is about one player starts here.
        builder.HasIndex(p => p.Puuid);

        // Team totals — kills, damage share — are aggregated per match on
        // every page of history, and without this the join degrades to a
        // scan of the whole table.
        builder.HasIndex(p => new { p.MatchId, p.TeamId });

        // Champion stats and attribution both filter remakes out, and the
        // column is overwhelmingly false, so this keeps them from
        // re-scanning to find the handful that are not.
        builder.HasIndex(p => new { p.Puuid, p.GameEndedInEarlySurrender });
    }
}
