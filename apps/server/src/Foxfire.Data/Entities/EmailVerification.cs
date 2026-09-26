using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// A link that proves somebody can read the mail sent to an address.
///
/// Two kinds, told apart by <see cref="Purpose"/>. A <c>verify</c> confirms the
/// address an account already has — the one sent when an account is made. A
/// <c>change</c> is how an account moves to a new address: the old one stays
/// the login until the new one proves it can receive mail, so a typo cannot
/// strand somebody on an address nobody reads.
///
/// The half that remembers, as a reset is; the travelling half is a signed
/// token naming this row (Foxfire.Core.EmailVerificationToken). The row says
/// which address, and whether it has been used or replaced.
/// </summary>
public sealed class EmailVerification
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }
    public FoxfireUser User { get; set; } = null!;

    /// <summary>
    /// The address being confirmed. For a <c>verify</c>, the account's own — the
    /// link goes dead if the account's address is no longer this. For a
    /// <c>change</c>, the address the account is moving to.
    /// </summary>
    public required string Email { get; set; }

    /// <summary><see cref="EmailVerificationPurposes"/>.</summary>
    public required string Purpose { get; set; }

    /// <summary>
    /// The account's security stamp when this was made. A <c>change</c> link
    /// dies with it: a password change after asking to move address is a good
    /// reason to stop trusting the ask.
    /// </summary>
    public required string SecurityStamp { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>When the link was used. Set by a conditional update, so two clicks confirm once.</summary>
    public DateTimeOffset? RedeemedAt { get; set; }

    /// <summary>Set when a newer link replaces it, or a pending change is cancelled.</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    public bool IsOpen(DateTimeOffset now) =>
        RedeemedAt is null && RevokedAt is null && ExpiresAt > now;
}

public static class EmailVerificationPurposes
{
    public const string Verify = "verify";
    public const string Change = "change";
}

internal sealed class EmailVerificationConfiguration : IEntityTypeConfiguration<EmailVerification>
{
    public void Configure(EntityTypeBuilder<EmailVerification> builder)
    {
        builder.HasKey(v => v.Id);

        builder.Property(v => v.Email).HasMaxLength(256);
        builder.Property(v => v.Purpose).HasMaxLength(16);
        builder.Property(v => v.SecurityStamp).HasMaxLength(256).IsRequired();

        // Somebody's outstanding link of each kind, and how many they have
        // asked for today.
        builder.HasIndex(v => new { v.UserId, v.Purpose, v.CreatedAt });

        // An account's confirmations go with it: they are about nothing else.
        builder.HasOne(v => v.User)
            .WithMany()
            .HasForeignKey(v => v.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
