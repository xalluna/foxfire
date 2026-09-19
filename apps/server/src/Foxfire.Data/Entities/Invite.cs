using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// Permission for one person to register while public signup is off.
///
/// This is the half of an invite that remembers. The travelling half is a signed
/// token naming this row (see Foxfire.Core.InviteToken), and the division of
/// labour matters: the signature says "this is a real invite from this server",
/// and only this row can say "and it has not been spent". That is what lets one
/// link be clicked any number of times and still complete exactly one
/// registration — the refusal comes from RedeemedByUserId, not from the token.
///
/// The email is here rather than in the token because tokens travel in URLs, and
/// URLs end up in browser history, referrer headers, chat previews and access
/// logs. The server reads it off this row instead.
///
/// An invite is not deleted when it is spent. The admin list wants to show who
/// took which invite, and a deleted row would make a used link indistinguishable
/// from a forged one.
/// </summary>
public sealed class Invite
{
    public Guid Id { get; set; }

    /// <summary>
    /// Who it was meant for. Registration must match it, so a leaked link opens
    /// nothing for anybody else.
    /// </summary>
    public required string Email { get; set; }

    /// <summary>The admin who created it. Null once that admin is deleted.</summary>
    public Guid? CreatedByUserId { get; set; }
    public FoxfireUser? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>
    /// Who used it, when that account still exists. Nulled if they are deleted.
    ///
    /// Deliberately not the record of whether the invite was spent — see
    /// RedeemedAt. Deleting somebody must not hand their invite back out.
    /// </summary>
    public Guid? RedeemedByUserId { get; set; }
    public FoxfireUser? RedeemedBy { get; set; }

    /// <summary>
    /// When it was used. Null means outstanding, and this is the column that
    /// says so — it is never cleared, by a deleted account or by anything else.
    ///
    /// It is also the whole one-registration rule. Redemption is a conditional
    /// UPDATE inside the transaction that creates the account: set this WHERE it
    /// is still null. Two people racing the same link both read it as open and
    /// both try; SQL Server serialises the writes on the row, the first sets it,
    /// and the second matches nothing and rolls its account back with it.
    /// </summary>
    public DateTimeOffset? RedeemedAt { get; set; }

    /// <summary>
    /// Set when an admin withdraws an invite that has not been used. Kept rather
    /// than deleted so the link explains itself when somebody finally clicks it.
    /// </summary>
    public DateTimeOffset? RevokedAt { get; set; }

    public bool IsOpen(DateTimeOffset now) =>
        RedeemedAt is null && RevokedAt is null && ExpiresAt > now;
}

internal sealed class InviteConfiguration : IEntityTypeConfiguration<Invite>
{
    public void Configure(EntityTypeBuilder<Invite> builder)
    {
        builder.HasKey(i => i.Id);
        builder.Property(i => i.Email).HasMaxLength(256).IsRequired();

        // The admin list opens on outstanding invites for an address, and
        // registration looks one up by the email it was offered.
        builder.HasIndex(i => i.Email);

        // Deleting an admin must not take their invites with them, and
        // deleting somebody must not delete the record of how they got in.
        builder.HasOne(i => i.CreatedBy)
            .WithMany()
            .HasForeignKey(i => i.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);

        // ClientSetNull, not SetNull, and that is forced rather than chosen.
        // SQL Server refuses two cascading paths between the same pair of
        // tables (error 1785), and CreatedBy already has the one. So EF nulls
        // this in memory when a tracked user is deleted and the constraint
        // itself is NO ACTION.
        //
        // Nothing is lost by it: whether an invite was spent is RedeemedAt,
        // which is never cleared. This column only says who, and "an account
        // that no longer exists" is a fair answer.
        builder.HasOne(i => i.RedeemedBy)
            .WithMany()
            .HasForeignKey(i => i.RedeemedByUserId)
            .OnDelete(DeleteBehavior.ClientSetNull);

        // Not unique. A unique index here would say one person may only ever
        // redeem one invite, which is a different rule and not one anybody
        // asked for — somebody who leaves and is invited back should be able
        // to. What makes an invite single-use is the conditional UPDATE on
        // RedeemedAt in the registration transaction.
        builder.HasIndex(i => i.RedeemedByUserId);
    }
}
