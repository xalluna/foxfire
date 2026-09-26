using System.Security.Cryptography;

namespace Foxfire.Core;

/// <param name="Status">Whether it may be used.</param>
/// <param name="VerificationId">Which confirmation it names. Meaningless unless Status is Valid.</param>
/// <param name="ExpiresAt">When it stops working. Meaningless unless the signature checked out.</param>
public sealed record EmailVerificationTokenResult(SignedTokenStatus Status, Guid VerificationId, DateTimeOffset ExpiresAt);

/// <summary>
/// The signed half of a link that confirms an email address — the one a new
/// account is sent, and the one that moves an account to a new address.
///
/// Built as a reset link is, for the same reasons, and with a key of its own
/// derived the same way from the invite key: a confirmation link never
/// verifies as a reset or an invite, nor either of them as this. The row it
/// names says which address, whose, and whether it has been used; the token
/// says only that the server made it, and until when.
/// </summary>
public static class EmailVerificationToken
{
    /// <summary>The label that separates this key from the invite key it comes from.</summary>
    private static ReadOnlySpan<byte> Purpose => "foxfire:email-verification"u8;

    /// <summary>Mints a token for a confirmation that already exists.</summary>
    public static string Issue(Guid verificationId, DateTimeOffset expiresAt, byte[] signingKey) =>
        SignedToken.Issue(verificationId, expiresAt, KeyFrom(signingKey));

    /// <summary>Checks a token and tells the caller which way it failed.</summary>
    public static EmailVerificationTokenResult Verify(string? token, byte[] signingKey, DateTimeOffset now)
    {
        var (status, id, expiresAt) = SignedToken.Verify(token, KeyFrom(signingKey), now);
        return new EmailVerificationTokenResult(status, id, expiresAt);
    }

    private static byte[] KeyFrom(byte[] signingKey)
    {
        ArgumentNullException.ThrowIfNull(signingKey);
        return HMACSHA256.HashData(signingKey, Purpose);
    }
}
