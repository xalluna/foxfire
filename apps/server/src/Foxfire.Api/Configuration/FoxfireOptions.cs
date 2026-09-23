using System.Net;
using System.Text;

namespace Foxfire.Api.Configuration;

/// <summary>Where this server lives, as everybody else sees it.</summary>
public sealed class ServerOptions
{
    public const string Section = "Server";

    /// <summary>
    /// The base URL invite links are built from, e.g. https://foxfire.example.com.
    ///
    /// The server cannot work this out for itself. Behind the reverse proxy a
    /// self-hoster is expected to run, every request arrives claiming to be for
    /// localhost, and an invite link to localhost is no use to the person it was
    /// sent to.
    /// </summary>
    public string PublicUrl { get; set; } = "";

    /// <summary>What this community calls itself. Shown on the connect screen.</summary>
    public string Name { get; set; } = "Foxfire";

    /// <summary>
    /// Addresses of reverse proxies whose X-Forwarded-For is believed, comma-separated.
    ///
    /// Behind a proxy every request arrives from the proxy, so without this the
    /// rate limits would count the whole community as one address — one person
    /// mistyping a password and everybody locked out together. Only the proxies
    /// named here are believed, because anybody else can write the header too.
    /// </summary>
    public string TrustedProxies { get; set; } = "";

    /// <summary>The same, as networks in CIDR form — 172.16.0.0/12 — for a proxy without a fixed address.</summary>
    public string TrustedNetworks { get; set; } = "";

    /// <summary>The trusted proxy addresses, parsed. Only valid after ConfigurationCheck has passed.</summary>
    public IEnumerable<IPAddress> TrustedProxyAddresses => Split(TrustedProxies).Select(IPAddress.Parse);

    /// <summary>The trusted proxy networks, parsed. Only valid after ConfigurationCheck has passed.</summary>
    public IEnumerable<IPNetwork> TrustedProxyNetworks => Split(TrustedNetworks).Select(n => IPNetwork.Parse(n));

    internal static IEnumerable<string> Split(string list) =>
        list.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

/// <summary>How many sign-ins, registrations and searches one address gets in a minute.</summary>
public sealed class RateLimitOptions
{
    public const string Section = "RateLimit";

    /// <summary>
    /// Sign-ins and registrations together. Enough for a household behind one
    /// address to all sign in at once, and a small fraction of what guessing a
    /// password would need.
    /// </summary>
    public int AuthPerMinute { get; set; } = 20;

    /// <summary>
    /// Searches, which the finder sends as somebody types.
    ///
    /// It used to be 30, back when every search was fourteen Riot requests on
    /// the community's one key and a spinner nobody would sit through twice.
    /// A search reads the database now — an unindexed substring scan over the
    /// tracked accounts, so still worth a limit, but a cheap one — and the
    /// caller is a box being typed into rather than a button being pressed.
    /// Thirty would have run out inside a couple of names.
    /// </summary>
    public int SearchPerMinute { get; set; } = 120;
}

/// <summary>The one Riot API key this server has.</summary>
public sealed class RiotOptions
{
    public const string Section = "Riot";

    /// <summary>
    /// A personal or production key from developer.riotgames.com.
    ///
    /// Configuration, read once at boot, never changed while running. A personal
    /// key expires every 24 hours, so a host on one is signing up for a daily
    /// restart; that is the cost of not keeping a rotatable secret in the
    /// database. While a key is refused, everything already stored still reads.
    /// </summary>
    public string ApiKey { get; set; } = "";

    /// <summary>
    /// "personal" (20/s, 100/2min) or "application" (500/10s, 30000/10min).
    ///
    /// Almost every self-hosted server is personal. Saying "application" when
    /// the key is not one just means collecting 429s faster.
    /// </summary>
    public string KeyType { get; set; } = "personal";
}

/// <summary>Signing keys and token lifetimes.</summary>
public sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>
    /// Signs access tokens. At least 32 bytes of randomness.
    ///
    /// Environment configuration rather than something generated on first run,
    /// so that it survives a container being recreated and a database being
    /// restored — and so there is no Data Protection key ring to mount, lose,
    /// and silently sign everybody out with.
    /// </summary>
    public string JwtSigningKey { get; set; } = "";

    /// <summary>
    /// Signs invite tokens, and — through a key derived from it — password
    /// reset links. A separate key from the JWT one, so leaking either does not
    /// leak both; see ResetToken for why the second kind is derived rather than
    /// configured.
    /// </summary>
    public string InviteSigningKey { get; set; } = "";

    /// <summary>
    /// How long an access token is good for. Short on purpose: it is not stored
    /// anywhere and so cannot be revoked, which is only safe while it is brief.
    /// </summary>
    public TimeSpan AccessTokenLifetime { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// How long a desktop can go without signing in again.
    ///
    /// Long, because the thing holding it is a background watcher that polls the
    /// League client for days at a time and must not stop to ask for a password.
    /// Revocable, unlike the access token, because it is a row.
    /// </summary>
    public TimeSpan RefreshTokenLifetime { get; set; } = TimeSpan.FromDays(30);

    /// <summary>How long an invite link works for.</summary>
    public TimeSpan InviteLifetime { get; set; } = TimeSpan.FromDays(14);

    /// <summary>
    /// How long a password reset link works for.
    ///
    /// Hours where an invite gets a fortnight, because the two are not the same
    /// kind of thing. An invite makes an account; a reset link takes one over,
    /// so it should stop being dangerous about as soon as somebody has had time
    /// to read the message it arrived in.
    /// </summary>
    public TimeSpan PasswordResetLifetime { get; set; } = TimeSpan.FromHours(24);

    public byte[] JwtSigningKeyBytes => Encoding.UTF8.GetBytes(JwtSigningKey);

    public byte[] InviteSigningKeyBytes => Encoding.UTF8.GetBytes(InviteSigningKey);
}

/// <summary>Who owns this server.</summary>
public sealed class AdminOptions
{
    public const string Section = "Admin";

    /// <summary>
    /// The email that becomes an admin the moment it registers.
    ///
    /// Seeded from configuration rather than given to whoever registers first,
    /// because public signup is on by default: a server reachable before its
    /// owner has got round to registering would otherwise belong to whoever
    /// found it. There is no window here — the claim is decided before the
    /// server accepts its first request.
    ///
    /// It also survives an accident. An admin who deletes themselves can
    /// register again and be an admin again.
    /// </summary>
    public string Email { get; set; } = "";
}

/// <summary>How outbound mail gets sent, when it does.</summary>
public sealed class SmtpOptions
{
    public const string Section = "Smtp";

    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string? FromAddress { get; set; }
    public string FromName { get; set; } = "Foxfire";
    public bool UseStartTls { get; set; } = true;

    /// <summary>
    /// Whether there is enough here to try sending anything.
    ///
    /// Optional on purpose. Homelab SMTP without a relay lands in spam when it
    /// is not refused outright, and the failure is silent — the host believes it
    /// works and the invitee never sees the mail. So nothing here is required to
    /// boot: every link the server would have emailed is also readable by an
    /// admin, who can paste it wherever their community actually talks.
    /// </summary>
    public bool IsConfigured => !string.IsNullOrWhiteSpace(Host) && !string.IsNullOrWhiteSpace(FromAddress);
}

/// <summary>
/// Checks the whole configuration at once, before anything starts.
///
/// All of it, in one message, rather than failing on the first missing value and
/// making a host restart a container five times to discover five settings. The
/// server refuses to start rather than starting degraded, because every one of
/// these is load-bearing: a server with no signing key issues tokens nobody can
/// verify, and one with no Riot key cannot do the thing it exists for.
/// </summary>
public static class ConfigurationCheck
{
    /// <summary>Signing keys shorter than this are not worth the name.</summary>
    private const int MinimumSigningKeyLength = 32;

    public static IReadOnlyList<string> Validate(
        string? connectionString,
        ServerOptions server,
        RiotOptions riot,
        AuthOptions auth,
        AdminOptions admin,
        RateLimitOptions rateLimits)
    {
        ArgumentNullException.ThrowIfNull(server);
        ArgumentNullException.ThrowIfNull(rateLimits);

        List<string> problems = [];

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            problems.Add("ConnectionStrings__Default is not set — the server has no database to talk to.");
        }

        if (string.IsNullOrWhiteSpace(server.PublicUrl))
        {
            problems.Add(
                "Server__PublicUrl is not set. Invite links are built from it, and behind a reverse proxy "
                + "the server cannot work out its own address.");
        }
        else if (!Uri.TryCreate(server.PublicUrl, UriKind.Absolute, out var url))
        {
            problems.Add($"Server__PublicUrl is not a URL: '{server.PublicUrl}'.");
        }
        else if (url.Scheme != Uri.UriSchemeHttps && !url.IsLoopback)
        {
            problems.Add(
                $"Server__PublicUrl is '{server.PublicUrl}'. Anything other than localhost must be https — "
                + "passwords and account tokens travel over this.");
        }

        if (string.IsNullOrWhiteSpace(riot.ApiKey))
        {
            problems.Add("Riot__ApiKey is not set. Get one from developer.riotgames.com.");
        }

        if (riot.KeyType is not ("personal" or "application"))
        {
            problems.Add($"Riot__KeyType must be 'personal' or 'application', not '{riot.KeyType}'.");
        }

        CheckSigningKey(problems, "Auth__JwtSigningKey", auth.JwtSigningKey);
        CheckSigningKey(problems, "Auth__InviteSigningKey", auth.InviteSigningKey);

        if (!string.IsNullOrWhiteSpace(auth.JwtSigningKey)
            && auth.JwtSigningKey == auth.InviteSigningKey)
        {
            problems.Add(
                "Auth__JwtSigningKey and Auth__InviteSigningKey are the same value. Use two, so that "
                + "leaking one does not leak both.");
        }

        if (string.IsNullOrWhiteSpace(admin.Email))
        {
            problems.Add(
                "Admin__Email is not set. It names the account that becomes this server's admin when it "
                + "registers — without it nobody can administer the server.");
        }

        foreach (var address in ServerOptions.Split(server.TrustedProxies))
        {
            if (!IPAddress.TryParse(address, out _))
            {
                problems.Add($"Server__TrustedProxies has '{address}', which is not an IP address.");
            }
        }

        foreach (var network in ServerOptions.Split(server.TrustedNetworks))
        {
            if (!IPNetwork.TryParse(network, out _))
            {
                problems.Add(
                    $"Server__TrustedNetworks has '{network}', which is not a network in CIDR form "
                    + "such as 172.16.0.0/12.");
            }
        }

        if (rateLimits.AuthPerMinute < 1)
        {
            problems.Add($"RateLimit__AuthPerMinute is {rateLimits.AuthPerMinute}; it has to be at least 1.");
        }

        if (rateLimits.SearchPerMinute < 1)
        {
            problems.Add($"RateLimit__SearchPerMinute is {rateLimits.SearchPerMinute}; it has to be at least 1.");
        }

        return problems;
    }

    private static void CheckSigningKey(List<string> problems, string name, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            problems.Add($"{name} is not set. Generate one with: openssl rand -base64 32");
            return;
        }

        if (Encoding.UTF8.GetByteCount(value) < MinimumSigningKeyLength)
        {
            problems.Add(
                $"{name} is too short — it needs at least {MinimumSigningKeyLength} bytes. "
                + "Generate one with: openssl rand -base64 32");
        }
    }
}
