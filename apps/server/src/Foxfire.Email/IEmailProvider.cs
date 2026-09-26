namespace Foxfire.Email;

/// <summary>
/// Something that can put an email in somebody's inbox.
///
/// The server's mail is provider-agnostic above this line: the outbox, the
/// limits, the tracking and the admin page know nothing about who carries the
/// message. A provider does one thing — try to send one message, and say
/// precisely how that went — because the difference between "try again in a
/// second", "try again tomorrow" and "never" is the whole of what the
/// dispatcher does with the answer.
///
/// Exactly one is active, named by Email__Provider. Each is registered keyed by
/// its <see cref="Name"/>; see Foxfire.Api/Email/EmailServices.cs.
/// </summary>
public interface IEmailProvider
{
    /// <summary>What Email__Provider calls it, and what every message it sent is marked with.</summary>
    string Name { get; }

    /// <summary>
    /// How much this provider's account may send, which is the provider's to
    /// say rather than the server's: the numbers come from whatever plan the
    /// account is on.
    /// </summary>
    EmailLimits Limits { get; }

    /// <summary>
    /// Tries to send one message, once.
    ///
    /// Never throws for anything the provider said or the network did — every
    /// outcome is a <see cref="EmailSendResult"/>, so the dispatcher has one
    /// place to decide what happens next. Cancellation is the exception, and
    /// only when <paramref name="cancellationToken"/> asked for it.
    ///
    /// <see cref="OutboundEmail.MessageId"/> is the idempotency key. Sending the
    /// same message twice — after a timeout that may or may not have got
    /// through — must not deliver it twice, for as long as the provider
    /// remembers keys.
    /// </summary>
    Task<EmailSendResult> SendAsync(OutboundEmail message, CancellationToken cancellationToken);
}

/// <summary>
/// How much one provider account may send.
/// </summary>
/// <param name="DailyLimit">Messages per UTC day. Zero is no cap — a paid plan has none.</param>
/// <param name="MonthlyLimit">Messages per month. Zero is no cap.</param>
/// <param name="MonthlyResetDay">
/// The day of the month the monthly count starts again, 1–31 — the billing day
/// on the provider's usage page. A day a month does not have is its last.
/// </param>
public sealed record EmailLimits(int DailyLimit, int MonthlyLimit, int MonthlyResetDay);

/// <summary>One message, ready to go.</summary>
/// <param name="MessageId">The outbox row's id. Also the idempotency key.</param>
/// <param name="From">The sender, display name included: <c>"Foxfire" &lt;mail@example.com&gt;</c>.</param>
/// <param name="To">Exactly one recipient. Every recipient is a message against the quota, so there is never more than one.</param>
/// <param name="Tags">Labels the provider shows beside the message in its own dashboard. ASCII letters, digits, _ and - only.</param>
public sealed record OutboundEmail(
    Guid MessageId,
    string From,
    string To,
    string Subject,
    string Html,
    string Text,
    IReadOnlyDictionary<string, string> Tags);

/// <summary>Which of a provider's two counts something is about.</summary>
public enum QuotaWindow
{
    Daily,
    Monthly
}

/// <summary>
/// How much of its quota a provider says has gone, as of one answer.
///
/// This is the provider's own count, and it can be larger than the server's:
/// anything else sending from the same account, or mail it receives, is on it.
/// That is why the limit is checked against the larger of the two.
/// </summary>
/// <param name="DailyUsed">Null when the provider did not say — a paid plan has no daily count to report.</param>
public sealed record QuotaObservation(int? DailyUsed, int? MonthlyUsed, DateTimeOffset At);

/// <summary>
/// How one attempt to send went.
///
/// Every case carries whatever the provider said about its quota on the way,
/// because it says so on errors as well as on successes.
/// </summary>
public abstract record EmailSendResult(QuotaObservation? Usage)
{
    /// <summary>Handed over. Whether it arrives is for the provider's webhooks to say.</summary>
    public sealed record Accepted(string ProviderMessageId, QuotaObservation? Usage) : EmailSendResult(Usage);

    /// <summary>Too many requests too quickly. The same message is fine after <paramref name="RetryAfter"/>.</summary>
    public sealed record RateLimited(TimeSpan RetryAfter, QuotaObservation? Usage) : EmailSendResult(Usage);

    /// <summary>
    /// The provider will send nothing more until a window resets. Holds every
    /// message, not just this one.
    /// </summary>
    public sealed record QuotaExhausted(QuotaWindow Window, QuotaObservation? Usage) : EmailSendResult(Usage);

    /// <summary>Something that should pass: an outage, a timeout, a network fault. Worth another go.</summary>
    public sealed record Transient(string Code, TimeSpan? RetryAfter, QuotaObservation? Usage) : EmailSendResult(Usage);

    /// <summary>This message will never be accepted as it is — a bad address, a rejected payload.</summary>
    public sealed record Permanent(string Code, QuotaObservation? Usage) : EmailSendResult(Usage);

    /// <summary>
    /// The provider refuses this server outright: the key is wrong or revoked,
    /// or the sending domain is not verified. No message will fare better, so
    /// every one is held until somebody fixes the configuration.
    /// </summary>
    public sealed record Refused(string Code, QuotaObservation? Usage) : EmailSendResult(Usage);
}
