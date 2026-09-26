namespace Foxfire.Api.Email;

/// <summary>Where the mail stood when the dispatcher last looked.</summary>
/// <param name="Queued">Waiting to go now.</param>
/// <param name="Held">Waiting on a limit, or on the provider taking this server's mail again.</param>
/// <param name="DailyUsed">What the day's limit is checked against: the larger of this server's count and the provider's.</param>
/// <param name="Refused">The provider's reason, while it is refusing everything this server sends.</param>
public sealed record EmailStateSnapshot(
    string Provider,
    int Queued,
    int Held,
    int DailyUsed,
    int DailyLimit,
    int MonthlyUsed,
    int MonthlyLimit,
    string? Refused,
    DateTimeOffset At);

/// <summary>
/// The dispatcher's last look at the queue and the quota, for the insights
/// collector — which samples it every ten seconds and should not have to ask
/// the database to do so. Null until the dispatcher has run, and always null on
/// a server that sends no mail.
/// </summary>
public sealed class EmailState
{
    private EmailStateSnapshot? _current;

    public EmailStateSnapshot? Current
    {
        get => Volatile.Read(ref _current);
        set => Volatile.Write(ref _current, value);
    }
}
