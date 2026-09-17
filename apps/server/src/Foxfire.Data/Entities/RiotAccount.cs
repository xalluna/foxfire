namespace Foxfire.Data.Entities;

/// <summary>
/// A League account this server tracks, and who on this server owns it.
///
/// Ownership is a nullable foreign key on this row rather than a link table, and
/// that is deliberate. The rule is that a Riot account belongs to at most one
/// Foxfire account at a time; a column can only hold one value, so the rule is
/// enforced by the shape of the table and not by a unique index somebody has to
/// remember to put on a join. Null means unclaimed, which is a real and ordinary
/// state — it is what every account imported from an existing stats.db starts
/// out as, waiting for its owner to claim it through the League client.
///
/// Claiming is first-writer-wins: the desktop reports the Riot ID the running
/// League client says is logged in, and the first Foxfire account to ask for an
/// unowned one gets it. That is not proof — a hand-written HTTP client can claim
/// any Riot ID — which is exactly why an admin can force-unlink. On a server
/// whose admin knows everybody, a lock with a key beats friction for everyone.
///
/// About Puuid. Riot encrypts puuids per API key, so this column is only
/// meaningful to the key that fetched it. Change the server's key and every
/// value here becomes undecryptable to Riot, which is why GameName and TagLine
/// are the durable identity and the puuid is re-resolved from them. Nothing
/// outside this server should ever be handed a puuid expecting it to mean
/// something elsewhere.
/// </summary>
public sealed class RiotAccount
{
    public Guid Id { get; set; }

    /// <summary>
    /// Riot's encrypted player id, under this server's API key. Unique.
    /// Re-resolved from the Riot ID whenever the key changes.
    /// </summary>
    public required string Puuid { get; set; }

    /// <summary>The name half of a Riot ID — the "Alluna" in Alluna#NA1.</summary>
    public required string GameName { get; set; }

    /// <summary>The tag half, without the hash.</summary>
    public required string TagLine { get; set; }

    /// <summary>Riot's platform id, e.g. na1. Decides which host match and league calls go to.</summary>
    public required string Platform { get; set; }

    /// <summary>The wider route, e.g. americas. Account and match lookups use this one.</summary>
    public required string RegionalRoute { get; set; }

    /// <summary>Riot's summoner id, when it has been fetched. Not needed to link.</summary>
    public string? SummonerId { get; set; }

    public int? ProfileIconId { get; set; }
    public long? SummonerLevel { get; set; }

    /// <summary>
    /// The Foxfire account that owns this one, or null for unclaimed.
    ///
    /// SET NULL on delete, not cascade: deleting a person must not delete the
    /// games. Match history is shared on this server — everybody can see
    /// everybody's — so it outlives any one account and the Riot account simply
    /// returns to unclaimed, ready for its owner to take it again.
    /// </summary>
    public Guid? OwnerId { get; set; }
    public FoxfireUser? Owner { get; set; }

    /// <summary>When the current owner claimed it. Null whenever OwnerId is.</summary>
    public DateTimeOffset? LinkedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Last time the Riot ID or profile was refreshed from Riot.</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>The Riot ID as a person writes it.</summary>
    public string RiotId => $"{GameName}#{TagLine}";
}
