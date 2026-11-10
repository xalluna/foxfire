using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Foxfire.Api.Media;

/// <summary>
/// Foxfire Media's webhook signature: <c>Foxfire-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</c>,
/// HMAC-SHA256 of <c>"{t}.{raw body}"</c> keyed with the application key. A
/// second <c>v1</c> rides along while Foxfire Media holds a secondary key, so
/// any one matching is enough.
///
/// Pure, so the rule is tested without a server: what is signed, how old a
/// signature may be, and that the comparison takes the same time whatever it finds.
/// </summary>
public static class MediaSignature
{
    public const string Header = "Foxfire-Signature";

    /// <summary>How far a signature's time may be from ours. Foxfire Media's retries sign again.</summary>
    public static readonly TimeSpan Tolerance = TimeSpan.FromMinutes(5);

    public static bool Verify(string? header, ReadOnlySpan<byte> body, string apiKey, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(header) || string.IsNullOrEmpty(apiKey)) return false;

        string? t = null;
        List<string> signatures = [];
        foreach (var part in header.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = part.IndexOf('=', StringComparison.Ordinal);
            if (eq <= 0) continue;
            var key = part[..eq];
            var value = part[(eq + 1)..];
            if (key == "t") t = value;
            else if (key == "v1") signatures.Add(value);
        }

        if (t is null || signatures.Count == 0) return false;
        if (!long.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out var unix)) return false;
        if (Math.Abs(now.ToUnixTimeSeconds() - unix) > Tolerance.TotalSeconds) return false;

        var expected = Encoding.ASCII.GetBytes(Compute(t, body, apiKey));
        var found = false;
        foreach (var signature in signatures)
        {
            found |= CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(signature), expected);
        }

        return found;
    }

    /// <summary>The header Foxfire Media would send. The tests' half of the rule.</summary>
    public static string Sign(ReadOnlySpan<byte> body, string apiKey, DateTimeOffset at)
    {
        var t = at.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        return $"t={t},v1={Compute(t, body, apiKey)}";
    }

    private static string Compute(string t, ReadOnlySpan<byte> body, string apiKey)
    {
        var prefix = Encoding.UTF8.GetBytes($"{t}.");
        var signed = new byte[prefix.Length + body.Length];
        prefix.CopyTo(signed, 0);
        body.CopyTo(signed.AsSpan(prefix.Length));
        return Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(apiKey), signed));
    }
}
