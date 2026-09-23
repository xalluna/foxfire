using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// Permission for one person to set a new password without knowing the old one.
///
/// The half that remembers, exactly as an invite is — the travelling half is a
/// signed token naming this row (see Foxfire.Core.ResetToken), and the same
/// division of labour applies: the signature says "this is a real reset from
/// this server", and only this row can say "and it has not been spent".
///
/// What an invite and a reset are for could hardly be further apart, though. An
/// invite creates an account; this hands one over. So it is short-lived, it is
/// replaced rather than accumulated — making a new one withdraws whatever was
/// outstanding, so there is never more than one live link to an account — and
/// it carries the account's security stamp.
///
/// Rows are not deleted when they are spent. Somebody who used a link a week
/// ago and clicks it again should be told it has been used, which is a
/// different answer from the one a forged token gets.
/// </summary>
public sealed class PasswordReset
{
    public Guid Id { get; set; }

    /// <summary>Whose password this sets.</summary>
    public Guid UserId { get; set; }
    public FoxfireUser User { get; set; } = null!;

    /// <summary>The admin who made it. Null once that admin is deleted.</summary>
    public Guid? CreatedByUserId { get; set; }
    public FoxfireUser? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>
    /// The account's security stamp when this was issued.
    ///
    /// Identity rotates the stamp whenever the password, the email or the
    /// username changes, so holding a copy is what lets a link go dead the
    /// moment the account moves underneath it. Somebody who remembers their
    /// password and signs in to change it themselves has, in the same act,
    /// turned off the link that was still sitting in a Discord message.
    /// </summary>
    public required string SecurityStamp { get; set; }

    /// <summary>
    /// When it was used. Null means outstanding, and this is the column that
    /// says so.
    ///
    /// Redemption is a conditional UPDATE — set this WHERE it is still null —
    /// so two people racing the same link cannot both set a password, the way
    /// two people racing an invite cannot both register.
    /// </summary>
    public DateTimeOffset? RedeemedAt { get; set; }

    /// <summary>Set when an admin withdraws a link, or makes a newer one that replaces it.</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    public bool IsOpen(DateTimeOffset now) =>
        RedeemedAt is null && RevokedAt is null && ExpiresAt > now;
}

internal sealed class PasswordResetConfiguration : IEntityTypeConfiguration<PasswordReset>
{
    public void Configure(EntityTypeBuilder<PasswordReset> builder)
    {
        builder.HasKey(r => r.Id);

        // Identity's stamp is a Guid in string form; the width is Identity's
        // own column, not a guess.
        builder.Property(r => r.SecurityStamp).HasMaxLength(256).IsRequired();

        // The one query the admin list runs: the open reset for each person.
        builder.HasIndex(r => new { r.UserId, r.RedeemedAt });

        // Deleting somebody takes their resets with them. A reset is about the
        // account it sets and nothing else, so there is nothing left to say
        // once that account is gone.
        builder.HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // ClientSetNull, not SetNull, and forced rather than chosen — SQL Server
        // refuses two cascading paths between the same pair of tables (error
        // 1785) and the line above has the one. So the constraint is NO ACTION,
        // and DeleteUserRequestHandler clears this column by hand before
        // deleting an admin, exactly as it does for the invites they sent.
        builder.HasOne(r => r.CreatedBy)
            .WithMany()
            .HasForeignKey(r => r.CreatedByUserId)
            .OnDelete(DeleteBehavior.ClientSetNull);
    }
}
