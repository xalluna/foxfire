namespace Foxfire.Riot;

/// <summary>
/// How much of a hurry a Riot call is in.
///
/// The desktop had no need for this: one person's app, one person's key, and a
/// plain FIFO queue was fair because there was only ever one person in it. A
/// server shares one key across everybody, and fairness stops being the same
/// thing as first-come-first-served — a friend's three-hour backfill would
/// otherwise sit in front of somebody watching a spinner.
///
/// Within a class it is still strictly FIFO. Classes never starve each other by
/// accident, because the only unbounded producer is the lowest one.
/// </summary>
public enum RiotRequestPriority
{
    /// <summary>
    /// Somebody is watching a spinner right now: an ad-hoc summoner search, or
    /// resolving a Riot ID while a person waits to link their account.
    /// </summary>
    Interactive = 0,

    /// <summary>
    /// A game just ended. match-v5 publishes minutes late, so this is already
    /// racing a retry ladder; putting it behind a backfill would lose the race
    /// and cost somebody their LP attribution for that game.
    /// </summary>
    PostGame = 1,

    /// <summary>
    /// Filling in history nobody is waiting on. Hours are fine. This is the only
    /// class that can be arbitrarily long, which is why it is last.
    /// </summary>
    Backfill = 2
}

/// <summary>Riot said no.</summary>
public sealed class RiotApiException : Exception
{
    public RiotApiException(
        string message,
        int status,
        TimeSpan? retryAfter = null,
        bool staleIdentity = false)
        : base(message)
    {
        Status = status;
        RetryAfter = retryAfter;
        StaleIdentity = staleIdentity;
    }

    /// <summary>The HTTP status. 0 when the request never got an answer at all.</summary>
    public int Status { get; }

    /// <summary>What Riot's Retry-After header said, when it said anything.</summary>
    public TimeSpan? RetryAfter { get; }

    /// <summary>
    /// Riot could not decrypt a puuid we sent, because it was encrypted under a
    /// different API key.
    ///
    /// Singled out from every other 400 because it is the one the server can
    /// repair by itself: re-resolve the account from its Riot ID, which is the
    /// identity that survives a key change, and write the new puuid over the
    /// old one.
    /// </summary>
    public bool StaleIdentity { get; }

    /// <summary>The key is expired, revoked, or was never valid.</summary>
    public bool IsKeyRejection => Status is 401 or 403;
}

/// <summary>
/// A key's allowance, as two sliding windows.
///
/// Riot enforces a short burst window and a long sustained one at the same time,
/// and a queue that respects only the first spends its whole sustained budget in
/// the first few seconds of a backfill and then sits in 429s.
/// </summary>
/// <param name="BurstLimit">Requests allowed per <paramref name="BurstWindow"/>.</param>
/// <param name="BurstWindow">The short window.</param>
/// <param name="SustainedLimit">Requests allowed per <paramref name="SustainedWindow"/>.</param>
/// <param name="SustainedWindow">The long window.</param>
/// <param name="RetryBackoff">Base delay for 5xx retries, multiplied by attempt number.</param>
public sealed record RiotRateLimits(
    int BurstLimit,
    TimeSpan BurstWindow,
    int SustainedLimit,
    TimeSpan SustainedWindow,
    TimeSpan RetryBackoff)
{
    /// <summary>
    /// What a personal key gets: 20 a second, 100 every two minutes.
    ///
    /// This is the number that shapes the whole server. It is not per user — it
    /// is the entire allowance for everybody on the instance, which is why
    /// backfill is a background class and why anything fetched per-player is
    /// cached rather than asked for again.
    /// </summary>
    public static readonly RiotRateLimits PersonalKey = new(
        BurstLimit: 20,
        BurstWindow: TimeSpan.FromSeconds(1),
        SustainedLimit: 100,
        SustainedWindow: TimeSpan.FromMinutes(2),
        RetryBackoff: TimeSpan.FromSeconds(1));

    /// <summary>
    /// What an approved application key gets — two orders of magnitude more.
    ///
    /// A default rather than a fact: limits are granted per product and an
    /// approved key can carry different ones. Few self-hosters will have one.
    /// </summary>
    public static readonly RiotRateLimits ApplicationKey = new(
        BurstLimit: 500,
        BurstWindow: TimeSpan.FromSeconds(10),
        SustainedLimit: 30_000,
        SustainedWindow: TimeSpan.FromMinutes(10),
        RetryBackoff: TimeSpan.FromSeconds(1));
}
