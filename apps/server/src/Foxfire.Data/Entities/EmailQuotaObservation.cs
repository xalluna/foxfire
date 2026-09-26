using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// The last thing a provider said about one of its quotas.
///
/// Every answer Resend gives says how much of the day and the month is gone,
/// counting mail this server did not send — anything else on the same account,
/// and mail the account received. That figure is kept here, one row per
/// provider and window, so the limit can be checked against the larger of it
/// and the server's own count.
///
/// In the database rather than in memory because two processes can be sending
/// at once — the old and the new, for the minute a deploy overlaps — and the
/// second must not start from nothing.
/// </summary>
public sealed class EmailQuotaObservation
{
    public required string Provider { get; set; }

    /// <summary>daily or monthly.</summary>
    public required string Window { get; set; }

    /// <summary>How many the provider said had been used.</summary>
    public int Used { get; set; }

    public DateTimeOffset ObservedAt { get; set; }

    /// <summary>
    /// Set when the provider refused a message because this window is spent:
    /// the end of the window. Nothing is sent before then, whatever the counts
    /// say — the provider has already said no.
    /// </summary>
    public DateTimeOffset? ExhaustedUntil { get; set; }
}

public static class EmailQuotaWindows
{
    public const string Daily = "daily";
    public const string Monthly = "monthly";
}

internal sealed class EmailQuotaObservationConfiguration : IEntityTypeConfiguration<EmailQuotaObservation>
{
    public void Configure(EntityTypeBuilder<EmailQuotaObservation> builder)
    {
        builder.HasKey(o => new { o.Provider, o.Window });

        builder.Property(o => o.Provider).HasMaxLength(32);
        builder.Property(o => o.Window).HasMaxLength(16);
    }
}
