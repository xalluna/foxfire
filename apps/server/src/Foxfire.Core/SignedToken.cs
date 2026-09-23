using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Foxfire.Core;

/// <summary>Why a token was or was not accepted.</summary>
public enum SignedTokenStatus
{
    Valid,

    /// <summary>Not the right shape — truncated, mistyped, or not one of ours.</summary>
    Malformed,

    /// <summary>Right shape, wrong signature. Forged, issued by a different server, or for a different purpose.</summary>
    BadSignature,

    /// <summary>Ours, intact, and past its date.</summary>
    Expired
}

/// <summary>
/// A row id and an expiry, signed, in a form that survives a URL.
///
/// The travelling half of anything this server hands somebody as a link. It
/// says "this is a real token from this server, and it names row X until Y",
/// and nothing else — whether row X has been spent, withdrawn or aimed at
/// somebody else is a question for the row, which is the half that remembers.
///
/// Two kinds of link are built on it, invites and password resets, and each
/// signs with its own key so that a token of one kind can never verify as the
/// other. See <see cref="ResetToken"/> for how the second key is arrived at
/// without asking a host to configure one.
/// </summary>
internal static class SignedToken
{
    // 16 bytes of Guid, then 8 of big-endian unix seconds.
    private const int PayloadBytes = 24;
    private const int SignatureBytes = 32; // HMAC-SHA256

    public static string Issue(Guid id, DateTimeOffset expiresAt, byte[] signingKey)
    {
        ArgumentNullException.ThrowIfNull(signingKey);

        Span<byte> payload = stackalloc byte[PayloadBytes];
        id.TryWriteBytes(payload[..16]);
        BinaryPrimitives.WriteInt64BigEndian(payload[16..], expiresAt.ToUnixTimeSeconds());

        Span<byte> signature = stackalloc byte[SignatureBytes];
        HMACSHA256.HashData(signingKey, payload, signature);

        return $"{Base64Url.Encode(payload)}.{Base64Url.Encode(signature)}";
    }

    /// <summary>
    /// Checks a token and says which way it failed.
    ///
    /// The signature is checked before the expiry, and compared in constant
    /// time. Checking expiry first would answer "expired" for a forgery, which
    /// tells whoever sent it that they very nearly had something — and a
    /// short-circuiting byte comparison would let them find the rest of the
    /// signature one byte at a time.
    /// </summary>
    public static (SignedTokenStatus Status, Guid Id, DateTimeOffset ExpiresAt) Verify(
        string? token,
        byte[] signingKey,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(signingKey);

        var malformed = (SignedTokenStatus.Malformed, Guid.Empty, default(DateTimeOffset));
        if (string.IsNullOrWhiteSpace(token)) return malformed;

        var dot = token.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0 || dot == token.Length - 1) return malformed;

        if (!Base64Url.TryDecode(token.AsSpan(0, dot), PayloadBytes, out var payload)) return malformed;
        if (!Base64Url.TryDecode(token.AsSpan(dot + 1), SignatureBytes, out var signature)) return malformed;

        Span<byte> expected = stackalloc byte[SignatureBytes];
        HMACSHA256.HashData(signingKey, payload, expected);
        if (!CryptographicOperations.FixedTimeEquals(expected, signature))
        {
            return (SignedTokenStatus.BadSignature, Guid.Empty, default);
        }

        var id = new Guid(payload.AsSpan(0, 16));
        var expiresAt = DateTimeOffset.FromUnixTimeSeconds(BinaryPrimitives.ReadInt64BigEndian(payload.AsSpan(16)));

        return expiresAt <= now
            ? (SignedTokenStatus.Expired, id, expiresAt)
            : (SignedTokenStatus.Valid, id, expiresAt);
    }
}

/// <summary>
/// Base64 without the characters that need escaping in a URL.
///
/// RFC 4648 §5, unpadded. The framework has this, but only over the exact
/// lengths we use here, and decoding wants a length check anyway — a token is
/// attacker-supplied, and every path through it has to end in a verdict rather
/// than an exception.
/// </summary>
internal static class Base64Url
{
    internal static string Encode(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    internal static bool TryDecode(ReadOnlySpan<char> text, int expectedBytes, out byte[] bytes)
    {
        bytes = [];

        var padded = new string(text).Replace('-', '+').Replace('_', '/');
        switch (padded.Length % 4)
        {
            case 0: break;
            case 2: padded += "=="; break;
            case 3: padded += "="; break;
            default: return false; // A single leftover character is never valid base64.
        }

        Span<byte> buffer = stackalloc byte[expectedBytes];
        if (!Convert.TryFromBase64String(padded, buffer, out var written) || written != expectedBytes)
        {
            return false;
        }

        bytes = buffer.ToArray();
        return true;
    }
}
