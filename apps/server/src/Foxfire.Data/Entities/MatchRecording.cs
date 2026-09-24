using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One player's recording of one game, on YouTube.
///
/// The opposite of <see cref="SharedReplay"/> in the way that matters. A .rofl
/// is of the game — the same file for all ten players — so it is kept once per
/// match. A recording is one player's screen, so it is kept once per match per
/// account: Ahri's history offers Ahri's video, Riven's history offers
/// Riven's, and a history that is neither offers nothing, even for a game
/// both of them recorded.
///
/// Nothing is stored but the id. YouTube hosts the video and plays it; this row
/// is the record that the account's owner said "this is my view of that game",
/// plus the markers the desktop captured while it was being played, so the web
/// can draw the same timeline the desktop always did.
/// </summary>
public sealed class MatchRecording
{
    public required string MatchId { get; set; }
    public Match Match { get; set; } = null!;

    /// <summary>
    /// Whose view of the game this is.
    ///
    /// The account rather than the puuid, deliberately. Puuids are encrypted
    /// per Riot key and re-resolved when the server's key changes, and a
    /// recording keyed on the old one would quietly stop belonging to anybody.
    /// </summary>
    public Guid RiotAccountId { get; set; }
    public RiotAccount RiotAccount { get; set; } = null!;

    /// <summary>YouTube's eleven-character id. Every URL is built from it, never stored.</summary>
    public required string YouTubeVideoId { get; set; }

    /// <summary>public, unlisted or private, as the uploader chose it. Null for a pasted link.</summary>
    public string? Privacy { get; set; }

    public string? Title { get; set; }

    public int? DurationSeconds { get; set; }

    /// <summary>
    /// The kills, deaths, assists and multikills, as JSON — the desktop's own
    /// RecordingEvent shape, stored as sent.
    ///
    /// Null for a link pasted in a browser, which has no events to send; the
    /// video plays without markers. JSON rather than a table because nothing
    /// ever queries into it: it is read whole, by the one page that draws it.
    /// </summary>
    public string? EventsJson { get; set; }

    /// <summary>"upload" when Foxfire put it on YouTube, "link" when somebody pasted one.</summary>
    public required string Source { get; set; }

    /// <summary>
    /// Who attached it, or null once they have left.
    ///
    /// SET NULL for the reason <see cref="SharedReplay.UploadedBy"/> is: the
    /// user going is not the video going.
    /// </summary>
    public Guid? AttachedByUserId { get; set; }
    public FoxfireUser? AttachedBy { get; set; }

    public DateTimeOffset AttachedAt { get; set; }
}

internal sealed class MatchRecordingConfiguration : IEntityTypeConfiguration<MatchRecording>
{
    public void Configure(EntityTypeBuilder<MatchRecording> builder)
    {
        // One per game per account: a second attach replaces the first.
        builder.HasKey(r => new { r.MatchId, r.RiotAccountId });

        builder.Property(r => r.MatchId).HasMaxLength(32);
        builder.Property(r => r.YouTubeVideoId).HasMaxLength(11);
        builder.Property(r => r.Privacy).HasMaxLength(16);
        builder.Property(r => r.Title).HasMaxLength(100);
        builder.Property(r => r.Source).HasMaxLength(8);

        builder.HasOne(r => r.Match)
            .WithMany()
            .HasForeignKey(r => r.MatchId)
            .OnDelete(DeleteBehavior.Cascade);

        // ClientSetNull for the reason MatchRank gives: SQL Server allows one
        // cascade path between a pair of tables, and the match already has it.
        // Riot accounts are never deleted on this server anyway.
        builder.HasOne(r => r.RiotAccount)
            .WithMany()
            .HasForeignKey(r => r.RiotAccountId)
            .OnDelete(DeleteBehavior.ClientSetNull);

        builder.HasOne(r => r.AttachedBy)
            .WithMany()
            .HasForeignKey(r => r.AttachedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
