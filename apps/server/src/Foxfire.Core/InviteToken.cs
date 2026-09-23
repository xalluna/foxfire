namespace Foxfire.Core;

/// <param name="Status">Whether it may be used.</param>
/// <param name="InviteId">Which invite it names. Meaningless unless Status is Valid.</param>
/// <param name="ExpiresAt">When it stops working. Meaningless unless the signature checked out.</param>
public sealed record InviteTokenResult(SignedTokenStatus Status, Guid InviteId, DateTimeOffset ExpiresAt);

/// <summary>
/// The signed half of an invite.
///
/// An invite is two things that fail differently, so they are kept apart. This
/// is the part that travels: a token naming an invite and an expiry, signed so
/// the server can tell its own tokens from anybody else's without a database
/// round trip. Whether that invite has already been spent is the other part, a
/// row, and it is the row that decides — a signature can only say "this is a
/// real invite", never "this invite is still going".
///
/// That split is what makes the behaviour asked for possible: a link that can
/// be clicked any number of times but completes exactly one registration. Every
/// click verifies the same still-valid token; the first registration to commit
/// writes the redemption row; every later one is refused by the row, not by the
/// token.
///
/// The payload is an invite id and an expiry, and pointedly not the email
/// address the invite was sent to. Tokens travel in URLs, URLs end up in browser
/// history, referrer headers, Discord previews and server logs, and there is no
/// reason to put somebody's email through all of that when the server can read
/// it off the row it is about to load anyway.
///
/// The mechanics are <see cref="SignedToken"/>, shared with password resets. An
/// invite signs with Auth__InviteSigningKey itself rather than anything derived
/// from it, so every link a running server has already handed out keeps working
/// across the upgrade that introduced the second kind.
/// </summary>
public static class InviteToken
{
    /// <summary>Mints a token for an invite that already exists.</summary>
    public static string Issue(Guid inviteId, DateTimeOffset expiresAt, byte[] signingKey) =>
        SignedToken.Issue(inviteId, expiresAt, signingKey);

    /// <summary>Checks a token and tells the caller which way it failed.</summary>
    public static InviteTokenResult Verify(string? token, byte[] signingKey, DateTimeOffset now)
    {
        var (status, id, expiresAt) = SignedToken.Verify(token, signingKey, now);
        return new InviteTokenResult(status, id, expiresAt);
    }
}
