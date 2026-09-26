using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One email the server meant to send: the queue it waits in, and the record of
/// what became of it.
///
/// The outbox and the log are the same table on purpose. A message is written
/// in the same transaction as whatever it is about — the invite, the reset —
/// so there is never an invite whose mail was lost between the database and
/// the provider, and the row that was the queue entry is the row a head admin
/// reads afterwards.
///
/// What is not here is as deliberate: the body, and the link in it. A link is a
/// bearer credential — an invite, a reset — and a table that kept them would
/// be one a database backup could take accounts over with. The row names what
/// it is about (<see cref="Kind"/>, <see cref="RelatedId"/>), and the message
/// is rebuilt from that row at the moment it is sent. Signed links are
/// deterministic, so the one emailed is the one an admin would copy.
///
/// Nothing here is a foreign key. The log outlives the accounts and invites it
/// mentions, and a row that cascaded away with its member would take the record
/// of what was sent to them with it.
/// </summary>
public sealed class EmailMessage
{
    /// <summary>Version 7, and also the idempotency key the provider is sent.</summary>
    public Guid Id { get; set; }

    /// <summary>What it is — see <see cref="EmailKinds"/>.</summary>
    public required string Kind { get; set; }

    /// <summary>0 for account security, which goes first; 1 for everything else.</summary>
    public byte Priority { get; set; }

    /// <summary>The provider it was queued for, as Email__Provider names it.</summary>
    public required string Provider { get; set; }

    public required string Recipient { get; set; }

    /// <summary>Kept so the log reads as a list of emails, and so every retry sends the same one.</summary>
    public required string Subject { get; set; }

    /// <summary>Where it has got to — see <see cref="EmailStatuses"/>.</summary>
    public required string Status { get; set; }

    /// <summary>
    /// Why it is where it is, when that is not obvious: <c>daily_limit</c> on a
    /// held message, <c>hard_bounce</c> on a bounced one, the provider's error
    /// name on a failed one.
    /// </summary>
    public string? Reason { get; set; }

    /// <summary>What the provider said about a bounce or a failure, for the admin page.</summary>
    public string? Detail { get; set; }

    /// <summary>The provider's own id, once it has accepted the message. How its webhooks find the row.</summary>
    public string? ProviderMessageId { get; set; }

    /// <summary>Whoever caused it to be sent — the admin who made the invite. Null when it was the server itself.</summary>
    public Guid? TriggeredByUserId { get; set; }

    /// <summary>The member it is about, when it is about one.</summary>
    public Guid? UserId { get; set; }

    /// <summary>The invite, reset or confirmation it carries the link for.</summary>
    public Guid? RelatedId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Not to be tried before this: a retry's backoff, or the end of a full window.</summary>
    public DateTimeOffset NotBefore { get; set; }

    /// <summary>
    /// When sending it stops being worth anything — the moment its link expires.
    /// A message still waiting then is dropped rather than sent.
    /// </summary>
    public DateTimeOffset WorthlessAfter { get; set; }

    /// <summary>
    /// While <see cref="Status"/> is sending, how long the process sending it
    /// has. A process that dies mid-send leaves this to lapse, and the message
    /// goes back in the queue — to be sent under the same idempotency key, so
    /// that if the first attempt did get through it is not delivered twice.
    /// </summary>
    public DateTimeOffset? LeaseUntil { get; set; }

    public int Attempts { get; set; }

    public DateTimeOffset? SentAt { get; set; }

    public DateTimeOffset? DeliveredAt { get; set; }

    /// <summary>When the provider last said anything about it.</summary>
    public DateTimeOffset? LastEventAt { get; set; }
}

/// <summary>What an email is for.</summary>
public static class EmailKinds
{
    public const string Invite = "invite";
    public const string PasswordReset = "password_reset";
    public const string Verification = "verification";
    public const string EmailChange = "email_change";
    public const string PasswordChanged = "password_changed";
    public const string Test = "test";

    public static IReadOnlyList<string> All { get; } =
        [Invite, PasswordReset, Verification, EmailChange, PasswordChanged, Test];
}

/// <summary>Where an email has got to.</summary>
public static class EmailStatuses
{
    /// <summary>Waiting its turn.</summary>
    public const string Queued = "queued";

    /// <summary>With the provider right now.</summary>
    public const string Sending = "sending";

    /// <summary>Waiting for a limit to reset, or for the provider to accept this server again.</summary>
    public const string Held = "held";

    /// <summary>Accepted by the provider.</summary>
    public const string Sent = "sent";

    /// <summary>The recipient's mail server took it.</summary>
    public const string Delivered = "delivered";

    public const string Bounced = "bounced";

    /// <summary>Delivered, and marked as spam.</summary>
    public const string Complained = "complained";

    /// <summary>Tried, and it will never go.</summary>
    public const string Failed = "failed";

    /// <summary>Never tried: its link lapsed, it was withdrawn, or the address is suppressed.</summary>
    public const string Dropped = "dropped";

    /// <summary>Still to go, one way or another.</summary>
    public static IReadOnlyList<string> Pending { get; } = [Queued, Sending, Held];

    public static IReadOnlyList<string> All { get; } =
        [Queued, Sending, Held, Sent, Delivered, Bounced, Complained, Failed, Dropped];

    /// <summary>
    /// How far along a status is, so that a webhook arriving late or twice can
    /// only ever move a message forward. Delivered comes after sent; a bounce,
    /// a complaint and a failure are all final.
    /// </summary>
    public static int Rank(string status) => status switch
    {
        Sent => 1,
        Delivered => 2,
        Bounced or Complained or Failed => 3,
        _ => 0
    };
}

internal sealed class EmailMessageConfiguration : IEntityTypeConfiguration<EmailMessage>
{
    public void Configure(EntityTypeBuilder<EmailMessage> builder)
    {
        builder.HasKey(m => m.Id);

        builder.Property(m => m.Kind).HasMaxLength(32);
        builder.Property(m => m.Provider).HasMaxLength(32);
        builder.Property(m => m.Recipient).HasMaxLength(256);
        builder.Property(m => m.Subject).HasMaxLength(200);
        builder.Property(m => m.Status).HasMaxLength(16);
        builder.Property(m => m.Reason).HasMaxLength(64);
        builder.Property(m => m.Detail).HasMaxLength(500);
        builder.Property(m => m.ProviderMessageId).HasMaxLength(128);

        // The dispatcher's question, every few seconds: what is due, in order.
        // Filtered to the handful still pending, so it stays small however long
        // the log grows.
        builder.HasIndex(m => new { m.Priority, m.NotBefore, m.CreatedAt })
            .HasDatabaseName("IX_EmailMessages_Pending")
            .HasFilter("[Status] IN ('queued', 'sending', 'held')");

        // The latest mail about an invite or a reset, for the admin lists.
        builder.HasIndex(m => new { m.Kind, m.RelatedId, m.CreatedAt });

        // How a webhook finds the message it is about.
        builder.HasIndex(m => m.ProviderMessageId)
            .HasFilter("[ProviderMessageId] IS NOT NULL");

        // Counting what went out today and this month.
        builder.HasIndex(m => m.SentAt)
            .HasFilter("[SentAt] IS NOT NULL");

        // The log, newest first, and the retention sweep.
        builder.HasIndex(m => new { m.CreatedAt, m.Id });

        builder.HasIndex(m => m.Recipient);
    }
}
