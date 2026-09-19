namespace Foxfire.Data.Entities;

/// <summary>
/// Settings an admin can change while the server is running.
///
/// A key/value table, the same shape as the desktop's app_settings, and for the
/// same reason: these are a handful of unrelated switches that each want to
/// change without a migration, not a record with a fixed set of fields.
///
/// What is pointedly NOT here is anything secret. The Riot API key, the database
/// and blob connection strings, the JWT and invite signing keys and the SMTP
/// credentials are all environment configuration, read once at boot, and the
/// server refuses to start without them. That means rotating the Riot key is an
/// edit and a restart rather than a button — a deliberate trade, taken because
/// the alternative is an encrypted column, a Data Protection key ring, and a
/// volume every host has to remember to mount or silently lose every session.
/// </summary>
public sealed class ServerSetting
{
    public required string Key { get; set; }

    /// <summary>The value as text. Empty string means cleared, never "unset".</summary>
    public required string Value { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>The keys this server actually reads, spelled once.</summary>
public static class ServerSettingKeys
{
    /// <summary>
    /// Whether anybody may register without an invite. "true" or "false".
    ///
    /// Defaults to on, per the design: a community server that nobody can join
    /// is the less useful mistake to make by accident. A host who wants it shut
    /// turns it off and hands out invites, and the admin account is seeded from
    /// configuration either way, so there is no window in which an open server
    /// is also an unclaimed one.
    /// </summary>
    public const string PublicSignup = "signup.public";

    /// <summary>
    /// How many matches to fetch when an account is first linked.
    ///
    /// Configurable because one personal Riot key is roughly 100 requests every
    /// two minutes for the whole server, and a backfill is about one request per
    /// match. What is a four-minute wait for one person is most of an afternoon
    /// for a group of ten, and a host should be able to decide how much of that
    /// they want to spend. Read in Phase 2, stored from the start so the setting
    /// does not arrive late and surprise anybody.
    /// </summary>
    public const string BackfillTarget = "sync.backfillTarget";

    /// <summary>
    /// How many bytes of blob storage replays may take. "0" means no cap.
    ///
    /// Uncapped by default, because a cap nobody chose is a cap that surprises
    /// somebody — and what it prevents is an upload being refused, which is
    /// exactly what the cap does. What it buys a host is deciding *when* that
    /// starts, rather than finding out from a storage bill or a full volume.
    /// </summary>
    public const string ReplayByteCap = "replays.byteCap";
}
