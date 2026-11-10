using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One player's recording of one game, kept on the server's Foxfire Media.
///
/// The opposite of <see cref="SharedReplay"/> in the way that matters. A .rofl
/// is of the game — the same file for all ten players — so it is kept once per
/// match. A recording is one player's screen, so it is kept once per match per
/// account: Ahri's history offers Ahri's video, Riven's history offers
/// Riven's, and a history that is neither offers nothing, even for a game
/// both of them recorded.
///
/// Nothing is stored but the id. Foxfire Media holds the video and plays it,
/// and the bytes go there straight from the desktop that recorded it; this row
/// is the record that the account's owner said "this is my view of that game",
/// where that video is in its life, and the markers the desktop captured while
/// it was played, so every client can draw the same timeline.
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

    /// <summary>Foxfire Media's eleven-character public id. Every URL is minted from it, never stored.</summary>
    public required string VideoId { get; set; }

    /// <summary>
    /// What this server called the video on Foxfire Media: <c>rec_{match}_{account}</c>,
    /// with a suffix once it has been replaced. Kept because Foxfire Media holds a
    /// deleted video's name until its files are gone, so a replacement needs a new one.
    /// </summary>
    public required string ExternalId { get; set; }

    /// <summary>
    /// uploading, upload_failed, processing, ready or failed — Foxfire Media's
    /// state, folded to what a client acts on. See Features/Recordings/RecordingStatuses.
    /// </summary>
    public required string Status { get; set; }

    /// <summary>Why processing or the upload failed, as Foxfire Media said it. Null otherwise.</summary>
    public string? Error { get; set; }

    public string? Title { get; set; }

    public int? DurationSeconds { get; set; }

    /// <summary>The size the desktop declared for the file it is uploading.</summary>
    public long SizeBytes { get; set; }

    /// <summary>
    /// The kills, deaths, assists and multikills, as JSON — the desktop's own
    /// RecordingEvent shape, stored as sent. JSON rather than a table because
    /// nothing ever queries into it: it is read whole, by the one page that draws it.
    /// </summary>
    public string? EventsJson { get; set; }

    /// <summary>
    /// Who uploaded it, or null once they have left.
    ///
    /// SET NULL for the reason <see cref="SharedReplay.UploadedBy"/> is: the
    /// user going is not the video going.
    /// </summary>
    public Guid? AttachedByUserId { get; set; }
    public FoxfireUser? AttachedBy { get; set; }

    public DateTimeOffset AttachedAt { get; set; }

    /// <summary>When Foxfire Media finished processing it.</summary>
    public DateTimeOffset? ReadyAt { get; set; }

    /// <summary>
    /// When this server last asked Foxfire Media how the video is doing. A read
    /// of a recording that is not ready yet asks again once this is old, which
    /// is what keeps a server Foxfire Media cannot reach with webhooks current.
    /// </summary>
    public DateTimeOffset? CheckedAt { get; set; }
}

internal sealed class MatchRecordingConfiguration : IEntityTypeConfiguration<MatchRecording>
{
    public void Configure(EntityTypeBuilder<MatchRecording> builder)
    {
        // One per game per account: a second upload replaces the first.
        builder.HasKey(r => new { r.MatchId, r.RiotAccountId });

        builder.Property(r => r.MatchId).HasMaxLength(32);
        builder.Property(r => r.VideoId).HasMaxLength(11);
        builder.Property(r => r.ExternalId).HasMaxLength(200);
        builder.Property(r => r.Status).HasMaxLength(16);
        builder.Property(r => r.Error).HasMaxLength(500);
        builder.Property(r => r.Title).HasMaxLength(200);

        // The webhook finds its row by the video.
        builder.HasIndex(r => r.VideoId);

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
