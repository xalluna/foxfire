using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Email;
using Foxfire.Api.Telemetry;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Email;

/// <summary>
/// A provider telling the server what became of mail it sent: delivered,
/// bounced, reported as spam.
///
/// Nothing is believed until the signature checks out against the secret only
/// the provider and this server hold. After that, each event moves its message
/// forward — never back: a delivery that arrives after a bounce, or the same
/// event twice, changes nothing. A hard bounce or a complaint stops mail to the
/// address, so the next invite does not spend the allowance bouncing again,
/// and a provider does not see this account keep sending to addresses that
/// refuse it.
///
/// An event about a message this server has no record of is not an error. The
/// provider account may send for other things too, and the log is pruned.
/// </summary>
public sealed record ReceiveEmailWebhookRequest(
    string Provider,
    IReadOnlyDictionary<string, string> Headers,
    byte[] Body) : IEmptyDomainRequest;

internal sealed class ReceiveEmailWebhookRequestHandler(
    FoxfireDbContext db,
    ActiveEmailProvider active,
    ServerMetrics metrics,
    TimeProvider time,
    ILogger<ReceiveEmailWebhookRequestHandler> logger)
    : IDomainRequestHandler<ReceiveEmailWebhookRequest>
{
    public async Task<Response> Handle(ReceiveEmailWebhookRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Not a provider this server sends through, or no secret to check with:
        // as if the route were not here at all.
        if (active.ReceiverFor(request.Provider) is not { } receiver) return Response.NotFound();

        var verdict = receiver.Verify(
            name => request.Headers.TryGetValue(name, out var value) ? value : null,
            request.Body,
            time.GetUtcNow());

        if (verdict != WebhookVerdict.Valid)
        {
            logger.LogWarning("Refused an email webhook claiming to be from {Provider}: {Verdict}", request.Provider, verdict);
            return Response.Failure(
                new Error("invalid_signature", "That webhook's signature does not check out."),
                HttpStatusCode.Unauthorized);
        }

        foreach (var delivery in receiver.Parse(request.Body))
        {
            await ApplyAsync(delivery, cancellationToken);
        }

        return Response.Success();
    }

    private async Task ApplyAsync(EmailDeliveryEvent delivery, CancellationToken cancellationToken)
    {
        var message = await db.EmailMessages
            .FirstOrDefaultAsync(m => m.ProviderMessageId == delivery.ProviderMessageId, cancellationToken);

        if (message is null)
        {
            logger.LogDebug(
                "An email webhook named {ProviderMessageId}, which this server has no record of", delivery.ProviderMessageId);
            return;
        }

        message.LastEventAt = delivery.At;

        switch (delivery.Kind)
        {
            case EmailDeliveryEventKind.Delivered:
                if (Advance(message, EmailStatuses.Delivered)) message.DeliveredAt = delivery.At;
                break;

            case EmailDeliveryEventKind.Delayed:
                if (message.Status == EmailStatuses.Sent) message.Reason = "delayed";
                break;

            case EmailDeliveryEventKind.Bounced:
                if (Advance(message, EmailStatuses.Bounced))
                {
                    message.Reason = delivery.Permanent ? "hard_bounce" : "soft_bounce";
                    message.Detail = delivery.Detail;
                }

                if (delivery.Permanent)
                {
                    await SuppressAsync(message, EmailSuppressionReasons.HardBounce, delivery.Detail, cancellationToken);

                    // An address that does not exist was never really confirmed
                    // — which is what an invite that registered somebody by
                    // arriving would otherwise have claimed.
                    await db.Users
                        .Where(u => u.NormalizedEmail == message.Recipient.ToUpperInvariant() && u.EmailConfirmed)
                        .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false), cancellationToken);
                }

                break;

            case EmailDeliveryEventKind.Complained:
                if (Advance(message, EmailStatuses.Complained)) message.Detail = delivery.Detail;
                await SuppressAsync(message, EmailSuppressionReasons.Complaint, delivery.Detail, cancellationToken);
                break;

            case EmailDeliveryEventKind.Failed:
                if (Advance(message, EmailStatuses.Failed))
                {
                    message.Reason = "provider_failed";
                    message.Detail = delivery.Detail;
                }

                break;

            case EmailDeliveryEventKind.Suppressed:
                if (EmailStatuses.Rank(message.Status) < EmailStatuses.Rank(EmailStatuses.Delivered))
                {
                    message.Status = EmailStatuses.Dropped;
                    message.Reason = EmailSuppressionReasons.ProviderSuppressed;
                    message.Detail = delivery.Detail;
                }

                await SuppressAsync(message, EmailSuppressionReasons.ProviderSuppressed, delivery.Detail, cancellationToken);
                break;

            default:
                break;
        }

        await db.SaveChangesAsync(cancellationToken);

        if (delivery.Kind != EmailDeliveryEventKind.Sent)
        {
            metrics.EmailEvent(message.Kind, EventName(delivery.Kind));
        }
    }

    /// <summary>Moves a message forward to <paramref name="status"/>, never back. False when it was already there or past it.</summary>
    private static bool Advance(EmailMessage message, string status)
    {
        if (EmailStatuses.Rank(message.Status) >= EmailStatuses.Rank(status)) return false;

        message.Status = status;
        return true;
    }

    private async Task SuppressAsync(EmailMessage message, string reason, string? detail, CancellationToken cancellationToken)
    {
        var address = EmailSuppression.Normalize(message.Recipient);
        if (await db.EmailSuppressions.AnyAsync(s => s.Address == address, cancellationToken)) return;

        db.EmailSuppressions.Add(new EmailSuppression
        {
            Id = Guid.CreateVersion7(),
            Address = address,
            Reason = reason,
            Detail = detail,
            MessageId = message.Id,
            CreatedAt = time.GetUtcNow()
        });

        logger.LogWarning(
            "Stopped sending email to {Address} after a {Reason} on {Kind} email {MessageId}",
            address, reason, message.Kind, message.Id);
    }

    private static string EventName(EmailDeliveryEventKind kind) => kind switch
    {
        EmailDeliveryEventKind.Delivered => "delivered",
        EmailDeliveryEventKind.Delayed => "delayed",
        EmailDeliveryEventKind.Bounced => "bounced",
        EmailDeliveryEventKind.Complained => "complained",
        EmailDeliveryEventKind.Failed => "failed",
        EmailDeliveryEventKind.Suppressed => "suppressed",
        _ => "sent"
    };
}
