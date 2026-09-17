using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Foxfire.Core;

/// <summary>Why a token was or was not accepted.</summary>
public enum InviteTokenStatus
{
    Valid,

    /// <summary>Not the right shape — truncated, mistyped, or not one of ours.</summary>
    Malformed,

    /// <summary>Right shape, wrong signature. Forged, or issued by a different server.</summary>
    BadSignature,

    /// <summary>Ours, intact, and past its date.</summary>
    Expired
}

/// <param name="Status">Whether it may be used.</param>
/// <param name="InviteId">Which invite it names. Meaningless unless Status is Valid.</param>
/// <param name="ExpiresAt">When it stops working. Meaningless unless the signature checked out.</param>
public sealed record InviteTokenResult(InviteTokenStatus Status, Guid InviteId, DateTimeOffset ExpiresAt);

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
/// </summary>
public static class InviteToken
{
    // 16 bytes of Guid, then 8 of big-endian unix seconds.
    private const int PayloadBytes = 24;
    private const int SignatureBytes = 32; // HMAC-SHA256

    /// <summary>Mints a token for an invite that already exists.</summary>
    public static string Issue(Guid inviteId, DateTimeOffset expiresAt, byte[] signingKey)
    {
        ArgumentNullException.ThrowIfNull(signingKey);

        Span<byte> payload = stackalloc byte[PayloadBytes];
        inviteId.TryWriteBytes(payload[..16]);
        BinaryPrimitives.WriteInt64BigEndian(payload[16..], expiresAt.ToUnixTimeSeconds());

        Span<byte> signature = stackalloc byte[SignatureBytes];
        HMACSHA256.HashData(signingKey, payload, signature);

        return $"{Base64Url.Encode(payload)}.{Base64Url.Encode(signature)}";
    }

    /// <summary>
    /// Checks a token and tells the caller which way it failed.
    ///
    /// The signature is checked before the expiry, and compared in constant
    /// time. Checking expiry first would answer "expired" for a forgery, which
    /// tells whoever sent it that they very nearly had something — and a
    /// short-circuiting byte comparison would let them find the rest of the
    /// signature one byte at a time.
    /// </summary>
    public static InviteTokenResult Verify(string? token, byte[] signingKey, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(signingKey);

        var malformed = new InviteTokenResult(InviteTokenStatus.Malformed, Guid.Empty, default);
        if (string.IsNullOrWhiteSpace(token)) return malformed;

        var dot = token.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0 || dot == token.Length - 1) return malformed;

        if (!Base64Url.TryDecode(token.AsSpan(0, dot), PayloadBytes, out var payload)) return malformed;
        if (!Base64Url.TryDecode(token.AsSpan(dot + 1), SignatureBytes, out var signature)) return malformed;

        Span<byte> expected = stackalloc byte[SignatureBytes];
        HMACSHA256.HashData(signingKey, payload, expected);
        if (!CryptographicOperations.FixedTimeEquals(expected, signature))
        {
            return new InviteTokenResult(InviteTokenStatus.BadSignature, Guid.Empty, default);
        }

        var inviteId = new Guid(payload.AsSpan(0, 16));
        var expiresAt = DateTimeOffset.FromUnixTimeSeconds(BinaryPrimitives.ReadInt64BigEndian(payload.AsSpan(16)));

        return expiresAt <= now
            ? new InviteTokenResult(InviteTokenStatus.Expired, inviteId, expiresAt)
            : new InviteTokenResult(InviteTokenStatus.Valid, inviteId, expiresAt);
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
