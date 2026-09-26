namespace Foxfire.Email;

/// <summary>
/// A provider that can tell the server what became of a message after it was
/// accepted — delivered, bounced, marked as spam.
///
/// Optional: a provider without webhooks still sends, and its messages stop at
/// "sent". No ASP.NET types, so that a provider stays a thing that can be
/// tested without a web host; the endpoint hands over headers and bytes.
/// </summary>
public interface IEmailWebhookReceiver
{
    /// <summary>Whether a signing secret is configured. Without one, nothing is accepted.</summary>
    bool CanVerify { get; }

    /// <summary>Whether a request really came from the provider, and recently.</summary>
    /// <param name="header">Reads a request header by name, or null when it is absent.</param>
    /// <param name="body">The raw body, exactly as it arrived. A signature covers every byte.</param>
    WebhookVerdict Verify(Func<string, string?> header, ReadOnlySpan<byte> body, DateTimeOffset now);

    /// <summary>
    /// What a verified body says happened. Empty for anything the server does
    /// not track — opens and clicks among them — and for a body it cannot read.
    /// </summary>
    IReadOnlyList<EmailDeliveryEvent> Parse(ReadOnlySpan<byte> body);
}

/// <summary>What a webhook's signature check found.</summary>
public enum WebhookVerdict
{
    Valid,

    /// <summary>The signature headers were not there.</summary>
    Missing,

    /// <summary>They were there, and not in a form that could be checked.</summary>
    Malformed,

    /// <summary>No signature matched: forged, or signed with another secret.</summary>
    BadSignature,

    /// <summary>Signed properly, too long ago or too far ahead — a replay, or a clock badly wrong.</summary>
    Stale
}

/// <summary>What happened to a message after it was handed over.</summary>
public enum EmailDeliveryEventKind
{
    /// <summary>The provider sent it on. Nothing the send result did not already say.</summary>
    Sent,

    /// <summary>The recipient's mail server took it.</summary>
    Delivered,

    /// <summary>Not delivered yet, and still being tried.</summary>
    Delayed,

    /// <summary>The recipient's mail server refused it.</summary>
    Bounced,

    /// <summary>Delivered, and marked as spam by the recipient.</summary>
    Complained,

    /// <summary>The provider could not send it after all.</summary>
    Failed,

    /// <summary>The provider refused to try, because the address is on its own suppression list.</summary>
    Suppressed
}

/// <param name="ProviderMessageId">The id the provider answered the send with.</param>
/// <param name="Permanent">
/// For a bounce, whether it was a hard one — the address does not exist or
/// will never accept mail. A soft bounce (a full mailbox) is worth trying again
/// another day; a hard one is not.
/// </param>
/// <param name="Detail">The provider's own words, for the admin page. Never shown to a member.</param>
public sealed record EmailDeliveryEvent(
    string ProviderMessageId,
    EmailDeliveryEventKind Kind,
    DateTimeOffset At,
    bool Permanent,
    string? Detail);
