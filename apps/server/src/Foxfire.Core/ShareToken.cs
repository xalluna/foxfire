using System.Security.Cryptography;

namespace Foxfire.Core;

/// <param name="Status">Whether it may be used.</param>
/// <param name="ShareLinkId">Which link it names. Meaningless unless Status is Valid.</param>
/// <param name="ExpiresAt">When it stops working. Meaningless unless the signature checked out.</param>
public sealed record ShareTokenResult(SignedTokenStatus Status, Guid ShareLinkId, DateTimeOffset ExpiresAt);

/// <summary>
/// The signed half of a share link: one profile, readable by whoever holds it.
///
/// Built as an invite and a reset are. The token names a ShareLink row and says
/// until when; the row says whether it was withdrawn and which account it opens.
/// It is recomputed from the row rather than stored, so the member who shared it
/// can copy the same link again without the server keeping anything that would
/// open a profile to whoever read the database.
///
/// Its key is derived from the invite key under a label of its own, for the
/// reason <see cref="ResetToken"/> gives: no new secret for a host to configure,
/// and no token of one kind that verifies as another. A share link is the
/// weakest thing this server signs — it reads one profile — and keeping it on a
/// key of its own means it can never be mistaken for something that does more.
/// </summary>
public static class ShareToken
{
    /// <summary>The label that separates this key from the invite key it comes from.</summary>
    private static ReadOnlySpan<byte> Purpose => "foxfire:share-link"u8;

    /// <summary>Mints a token for a link that already exists.</summary>
    public static string Issue(Guid shareLinkId, DateTimeOffset expiresAt, byte[] signingKey) =>
        SignedToken.Issue(shareLinkId, expiresAt, KeyFrom(signingKey));

    /// <summary>Checks a token and tells the caller which way it failed.</summary>
    public static ShareTokenResult Verify(string? token, byte[] signingKey, DateTimeOffset now)
    {
        var (status, id, expiresAt) = SignedToken.Verify(token, KeyFrom(signingKey), now);
        return new ShareTokenResult(status, id, expiresAt);
    }

    private static byte[] KeyFrom(byte[] signingKey)
    {
        ArgumentNullException.ThrowIfNull(signingKey);
        return HMACSHA256.HashData(signingKey, Purpose);
    }
}
