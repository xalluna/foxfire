using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One long-lived credential, held by one desktop install.
///
/// Access tokens are minutes long and are never stored anywhere; this is the
/// thing that survives, and the reason the LCU watcher can sit polling for days
/// without anybody signing in again.
///
/// Only a hash is kept. A refresh token is a password for an account, and a
/// server that stores them in readable form hands over every logged-in session
/// the moment its database is read by the wrong person. SHA-256 with no salt is
/// right here and would be wrong for a password: the input is 256 bits of
/// randomness this server generated, so there is no dictionary to attack and
/// nothing a rainbow table could precompute.
///
/// They rotate. Each refresh mints a replacement and marks this one used, so a
/// token that is presented twice means the copy it was cloned from is in use
/// somewhere — which is why ReplacedBy is recorded rather than the row simply
/// being deleted.
/// </summary>
public sealed class RefreshToken
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }
    public FoxfireUser User { get; set; } = null!;

    /// <summary>SHA-256 of the token that was handed out. Unique: it is the lookup key.</summary>
    public required byte[] TokenHash { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>
    /// Set when this token is spent or revoked. Null means live.
    /// </summary>
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>
    /// The token minted when this one was refreshed, if it was.
    ///
    /// Kept so that a replayed token can be recognised as a clone of a chain
    /// that is still running, rather than looking like an ordinary expiry.
    /// </summary>
    public Guid? ReplacedById { get; set; }

    /// <summary>
    /// Free text from the desktop, for the admin user list: which machine this
    /// session belongs to. Never trusted for anything.
    /// </summary>
    public string? DeviceLabel { get; set; }

    public bool IsLive(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;
}

internal sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.HasKey(t => t.Id);

        // The lookup key, so it is indexed — and unique, because two live
        // sessions hashing to one row would mean a collision nobody would
        // ever diagnose.
        builder.Property(t => t.TokenHash).HasMaxLength(32).IsRequired();
        builder.HasIndex(t => t.TokenHash).IsUnique();

        builder.Property(t => t.DeviceLabel).HasMaxLength(128);

        // Signing out everywhere, and deleting an account, both mean every
        // session goes with it. Nothing outside the session refers to these.
        builder.HasOne(t => t.User)
            .WithMany()
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // The sweep that clears dead sessions reads exactly this.
        builder.HasIndex(t => new { t.UserId, t.ExpiresAt });
    }
}
