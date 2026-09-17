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
