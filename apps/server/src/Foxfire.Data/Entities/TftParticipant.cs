using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One player's board in one TFT game, projected out of the payload.
///
/// TFT's own table rather than nullable columns on <see cref="MatchParticipant"/>,
/// because almost nothing carries over: a TFT game has a placement rather than
/// a result, a board rather than a champion, traits rather than runes. The
/// game itself is a <see cref="Match"/> like any other — which is what lets
/// LP attribution, hand-entered LP and recordings point at it with the keys
/// they already have.
///
/// Every League read starts from <see cref="MatchParticipant"/> by puuid, so a
/// TFT game, which has no rows there, is invisible to all of them.
/// </summary>
public sealed class TftParticipant
{
    public required string MatchId { get; set; }
    public Match Match { get; set; } = null!;

    /// <summary>
    /// Riot's encrypted player id, under whichever key fetched the game.
    ///
    /// The main key's, unless the server has a TFT key of its own, in which
    /// case it is that key's — a different string for the same player. See
    /// <see cref="ScopedPuuid"/>.
    /// </summary>
    public required string Puuid { get; set; }

    /// <summary>Who they were called at the time, when Riot said. Older payloads do not.</summary>
    public string? GameName { get; set; }
    public string? TagLine { get; set; }

    /// <summary>1 to 8, the player's own.</summary>
    public int Placement { get; set; }

    /// <summary>
    /// 1 to 4 in Double Up, the team's, worked out from the whole lobby on the
    /// way in. Null in every other queue.
    /// </summary>
    public int? TeamPlacement { get; set; }

    public int? PartnerGroupId { get; set; }

    public int Level { get; set; }

    /// <summary>Riot's running round count, which a client shows as a stage.</summary>
    public int LastRound { get; set; }

    /// <summary>
    /// Seconds from the start until this player was knocked out, or the game ended.
    ///
    /// Where attribution places the game: TFT moves LP at the elimination, not
    /// when the last player in the lobby finishes. Fractional, as Riot sends it.
    /// </summary>
    public double TimeEliminated { get; set; }

    public int PlayersEliminated { get; set; }
    public int TotalDamageToPlayers { get; set; }
    public int GoldLeft { get; set; }

    /// <summary>A top-four finish, as Riot counts one.</summary>
    public bool Win { get; set; }

    /// <summary>
    /// The board's traits, as Foxfire's own camelCase JSON — name, units, style,
    /// tier — rather than Riot's. Nothing queries inside it; it is read whole
    /// to draw a row.
    /// </summary>
    public required string TraitsJson { get; set; }

    /// <summary>The board's units: id, star level, rarity and items, as Foxfire's JSON.</summary>
    public required string UnitsJson { get; set; }

    /// <summary>The augments picked, as a JSON array of ids. Null when the payload had none.</summary>
    public string? AugmentsJson { get; set; }
}

internal sealed class TftParticipantConfiguration : IEntityTypeConfiguration<TftParticipant>
{
    public void Configure(EntityTypeBuilder<TftParticipant> builder)
    {
        builder.HasKey(p => new { p.MatchId, p.Puuid });

        builder.Property(p => p.MatchId).HasMaxLength(32);
        builder.Property(p => p.Puuid).HasMaxLength(78);
        builder.Property(p => p.GameName).HasMaxLength(64);
        builder.Property(p => p.TagLine).HasMaxLength(16);
        builder.Property(p => p.AugmentsJson).HasMaxLength(1024);

        builder.HasOne(p => p.Match)
            .WithMany(m => m.TftParticipants)
            .HasForeignKey(p => p.MatchId)
            .OnDelete(DeleteBehavior.Cascade);

        // Every TFT screen about one player starts here, as League's start
        // from MatchParticipants.Puuid.
        builder.HasIndex(p => p.Puuid);
    }
}
