using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Foxfire.Email.Resend;

/// <summary>
/// The signature on Resend's webhooks, which are sent through Svix.
///
/// Written out rather than taken as a package, because it is a dozen lines:
/// HMAC-SHA256, keyed with the base64 after the secret's <c>whsec_</c>, over
/// <c>{svix-id}.{svix-timestamp}.{body}</c>. The header can carry several
/// signatures at once, space-separated, each <c>v1,&lt;base64&gt;</c>, so a secret
/// can be rotated without dropping events; any one matching is enough.
///
/// The timestamp is part of what is signed, and one more than five minutes
/// from now is refused. Without that, an event captured once could be sent
/// again forever.
/// </summary>
public static class SvixSignature
{
    public const string IdHeader = "svix-id";
    public const string TimestampHeader = "svix-timestamp";
    public const string SignatureHeader = "svix-signature";

    /// <summary>How far a timestamp may be from now, either way.</summary>
    public static readonly TimeSpan Tolerance = TimeSpan.FromMinutes(5);

    private const string SecretPrefix = "whsec_";

    /// <summary>Whether a secret has the shape one has to have. Checked at boot.</summary>
    public static bool IsWellFormedSecret(string? secret) => KeyFrom(secret) is not null;

    public static WebhookVerdict Verify(
        string? secret,
        string? id,
        string? timestamp,
        string? signatures,
        ReadOnlySpan<byte> body,
        DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(timestamp) || string.IsNullOrEmpty(signatures))
        {
            return WebhookVerdict.Missing;
        }

        if (KeyFrom(secret) is not { } key) return WebhookVerdict.BadSignature;

        if (!long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds))
        {
            return WebhookVerdict.Malformed;
        }

        var expected = Compute(key, id, timestamp, body);
        var anyWellFormed = false;

        foreach (var candidate in signatures.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var comma = candidate.IndexOf(',', StringComparison.Ordinal);
            if (comma <= 0 || candidate[..comma] != "v1") continue;

            byte[] presented;
            try
            {
                presented = Convert.FromBase64String(candidate[(comma + 1)..]);
            }
            catch (FormatException)
            {
                continue;
            }

            anyWellFormed = true;
            if (!CryptographicOperations.FixedTimeEquals(presented, expected)) continue;

            // Signature first, then the clock, for the reason SignedToken
            // checks them in that order: "stale" is only said to a sender who
            // holds the secret.
            DateTimeOffset sentAt;
            try
            {
                sentAt = DateTimeOffset.FromUnixTimeSeconds(seconds);
            }
            catch (ArgumentOutOfRangeException)
            {
                return WebhookVerdict.Malformed;
            }

            return (now - sentAt).Duration() > Tolerance ? WebhookVerdict.Stale : WebhookVerdict.Valid;
        }

        return anyWellFormed ? WebhookVerdict.BadSignature : WebhookVerdict.Malformed;
    }

    /// <summary>
    /// The header value Svix would send for this body. For tests, and for
    /// anybody checking by hand what a webhook should have carried.
    /// </summary>
    public static string Sign(string secret, string id, string timestamp, ReadOnlySpan<byte> body)
    {
        var key = KeyFrom(secret) ?? throw new ArgumentException("Not a whsec_ secret.", nameof(secret));
        return $"v1,{Convert.ToBase64String(Compute(key, id, timestamp, body))}";
    }

    private static byte[] Compute(byte[] key, string id, string timestamp, ReadOnlySpan<byte> body)
    {
        var prefix = Encoding.UTF8.GetBytes($"{id}.{timestamp}.");
        var signed = new byte[prefix.Length + body.Length];
        prefix.CopyTo(signed, 0);
        body.CopyTo(signed.AsSpan(prefix.Length));

        return HMACSHA256.HashData(key, signed);
    }

    private static byte[]? KeyFrom(string? secret)
    {
        if (string.IsNullOrWhiteSpace(secret)) return null;

        var trimmed = secret.Trim();
        if (!trimmed.StartsWith(SecretPrefix, StringComparison.Ordinal)) return null;

        try
        {
            var key = Convert.FromBase64String(trimmed[SecretPrefix.Length..]);
            return key.Length == 0 ? null : key;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
