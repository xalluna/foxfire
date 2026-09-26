using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Email;

/// <summary>
/// A test email, to any address — for checking the key, the domain and the
/// webhook end to end, and deliverability to a given inbox.
///
/// It goes through the queue like everything else, so it is counted, held when
/// the day is full, and shows up in the log. Standard mail: a head admin
/// testing cannot use the reserve kept for resets.
/// </summary>
public sealed record SendTestEmailRequest(string To) : IValidatedRequest<EmailLogEntry>;

internal sealed class SendTestEmailRequestValidator : AbstractValidator<SendTestEmailRequest>
{
    public SendTestEmailRequestValidator() =>
        RuleFor(x => (x.To ?? string.Empty).Trim())
            .Must(to => to.Length is > 0 and <= 256 && to.Contains('@', StringComparison.Ordinal) && !to.Any(char.IsWhiteSpace))
            .WithErrorCode("invalid_email")
            .WithMessage("That does not look like an email address.");
}

internal sealed class SendTestEmailRequestHandler(
    FoxfireDbContext db,
    EmailOutbox outbox,
    IIdentityContext me,
    TimeProvider time,
    ILogger<SendTestEmailRequestHandler> logger)
    : IValidatedRequestHandler<SendTestEmailRequest, EmailLogEntry>
{
    /// <summary>A test that has not gone within the hour tests nothing anybody is waiting on.</summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(1);

    public async Task<Response<EmailLogEntry>> Handle(SendTestEmailRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!outbox.IsEnabled)
        {
            return new Error("email_unavailable", "This server has no email provider configured, so there is nothing to test.");
        }

        var to = request.To.Trim();

        if (await outbox.IsSuppressedAsync(to, cancellationToken))
        {
            return new Error(
                "email_suppressed",
                "Mail to that address bounced or was reported, so it is no longer sent to. Clear it below first.");
        }

        var message = await outbox.AddAsync(
            EmailKinds.Test,
            EmailPriority.Standard,
            to,
            relatedId: null,
            userId: null,
            triggeredBy: me.UserId,
            worthlessAfter: time.GetUtcNow() + Lifetime,
            cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("{Actor} sent a test email to {Address}", me.Username, to);

        var entry = await db.EmailMessages
            .AsNoTracking()
            .Where(m => m.Id == message!.Id)
            .Select(m => new EmailLogEntry(
                m.Id, m.Kind, m.Recipient, m.Subject, m.Status, m.Reason, m.Detail, m.Attempts, m.CreatedAt,
                m.NotBefore, m.SentAt, m.DeliveredAt, m.LastEventAt, me.Username))
            .FirstAsync(cancellationToken);

        return entry;
    }
}
