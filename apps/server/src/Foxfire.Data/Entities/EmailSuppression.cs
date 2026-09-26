using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// An address this server will not send to again.
///
/// Added when a message to it bounced hard, was marked as spam, or was refused
/// by the provider because the provider has given up on it too. Sending again
/// would bounce again — spending the day's allowance on nothing — and a
/// provider watches how often an account bounces or is reported, and suspends
/// the ones that keep doing it.
///
/// By address, not by member. The address is what bounces; a member who moves
/// to a working address is no longer affected, and the old one stays here
/// because it still does not work. A head admin can clear one — somebody fixed
/// their mailbox — from the Email page.
/// </summary>
public sealed class EmailSuppression
{
    public Guid Id { get; set; }

    /// <summary>Lowercased and trimmed, which is how it is compared.</summary>
    public required string Address { get; set; }

    /// <summary>hard_bounce, complaint or provider_suppressed.</summary>
    public required string Reason { get; set; }

    /// <summary>What the provider said, when it said anything.</summary>
    public string? Detail { get; set; }

    /// <summary>The message that found out. Not a foreign key: the log is pruned and this is not.</summary>
    public Guid? MessageId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public static string Normalize(string address) => address.Trim().ToLowerInvariant();
}

/// <summary>Why an address is suppressed.</summary>
public static class EmailSuppressionReasons
{
    public const string HardBounce = "hard_bounce";
    public const string Complaint = "complaint";
    public const string ProviderSuppressed = "provider_suppressed";
}

internal sealed class EmailSuppressionConfiguration : IEntityTypeConfiguration<EmailSuppression>
{
    public void Configure(EntityTypeBuilder<EmailSuppression> builder)
    {
        builder.HasKey(s => s.Id);

        builder.Property(s => s.Address).HasMaxLength(256);
        builder.Property(s => s.Reason).HasMaxLength(32);
        builder.Property(s => s.Detail).HasMaxLength(500);

        builder.HasIndex(s => s.Address).IsUnique();
        builder.HasIndex(s => new { s.CreatedAt, s.Id });
    }
}
