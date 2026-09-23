using System.Security.Cryptography;

namespace Foxfire.Core;

/// <param name="Status">Whether it may be used.</param>
/// <param name="ResetId">Which reset it names. Meaningless unless Status is Valid.</param>
/// <param name="ExpiresAt">When it stops working. Meaningless unless the signature checked out.</param>
public sealed record ResetTokenResult(SignedTokenStatus Status, Guid ResetId, DateTimeOffset ExpiresAt);

/// <summary>
/// The signed half of a password reset, built exactly as an invite is.
///
/// Same split, same reasons: the token says which reset row this is and until
/// when, and the row says whether it has been used, withdrawn, or overtaken by
/// a newer one. Because the token is recomputed from the row rather than
/// stored, an admin can copy the same link again tomorrow — the way they can
/// with an invite — without the server ever keeping a value that would let
/// whoever read the database take an account over.
///
/// What differs is the key and the lifetime. An invite creates an account; a
/// reset link takes one over, so it lasts hours rather than a fortnight, and it
/// is signed with a key of its own. That key is derived rather than configured:
/// a new required setting would stop every existing server booting on upgrade,
/// and one more secret to generate is one more to put in the wrong file.
/// HMAC of the invite key under a fixed label gives a key that cannot be walked
/// back to it and has nothing to do with it — so a reset token never verifies
/// as an invite, an invite never verifies as a reset, and the pair of them
/// still rest on the one secret a host was already asked for.
/// </summary>
public static class ResetToken
{
    /// <summary>The label that separates this key from the invite key it comes from.</summary>
    private static ReadOnlySpan<byte> Purpose => "foxfire:password-reset"u8;

    /// <summary>Mints a token for a reset that already exists.</summary>
    public static string Issue(Guid resetId, DateTimeOffset expiresAt, byte[] signingKey) =>
        SignedToken.Issue(resetId, expiresAt, KeyFrom(signingKey));

    /// <summary>Checks a token and tells the caller which way it failed.</summary>
    public static ResetTokenResult Verify(string? token, byte[] signingKey, DateTimeOffset now)
    {
        var (status, id, expiresAt) = SignedToken.Verify(token, KeyFrom(signingKey), now);
        return new ResetTokenResult(status, id, expiresAt);
    }

    private static byte[] KeyFrom(byte[] signingKey)
    {
        ArgumentNullException.ThrowIfNull(signingKey);
        return HMACSHA256.HashData(signingKey, Purpose);
    }
}
