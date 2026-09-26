using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.AspNetCore.Identity;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// Another confirmation link, for the address you are moving to or, failing
/// that, the one you have.
///
/// A new link withdraws the old one, so the email that arrives last is the one
/// that works. Security mail: it is the member asking, one at a time, and it is
/// what stands between them and a reset link they may need.
/// </summary>
public sealed record ResendEmailConfirmationRequest : IDomainRequest<AccountEmailResponse>;

internal sealed class ResendEmailConfirmationRequestHandler(
    UserManager<FoxfireUser> users,
    FoxfireDbContext db,
    EmailOutbox outbox,
    IIdentityContext me,
    TimeProvider time,
    ILogger<ResendEmailConfirmationRequestHandler> logger)
    : IDomainRequestHandler<ResendEmailConfirmationRequest, AccountEmailResponse>
{
    public async Task<Response<AccountEmailResponse>> Handle(
        ResendEmailConfirmationRequest request,
        CancellationToken cancellationToken)
    {
        var user = await Accounts.SignedInAsync(users, me);
        if (user is null) return Accounts.SignedOut<AccountEmailResponse>();

        if (!outbox.IsEnabled)
        {
            return new Error("email_unavailable", "This server doesn't send email, so there is nothing to confirm with.");
        }

        var now = time.GetUtcNow();
        var pending = await AccountEmail.PendingChangeAsync(db, user, now, cancellationToken);

        if (pending is null && user.EmailConfirmed)
        {
            return new Error("nothing_to_confirm", "Your address is already confirmed.");
        }

        if (await AccountEmail.NextAllowedAsync(db, user.Id, now, gap: true, cancellationToken) is { } next)
        {
            return Response<AccountEmailResponse>.Failure(
                new Error(
                    "confirmation_throttled",
                    $"A link was sent a moment ago. You can ask for another after {next:HH:mm} UTC."),
                HttpStatusCode.TooManyRequests);
        }

        var (purpose, address) = pending is not null
            ? (EmailVerificationPurposes.Change, pending.Email)
            : (EmailVerificationPurposes.Verify, user.Email ?? "");

        if (await outbox.IsSuppressedAsync(address, cancellationToken))
        {
            return new Error(
                "email_suppressed",
                "Mail to that address bounced, so this server no longer sends to it. Ask a head admin to clear it, or use a different address.");
        }

        await AccountEmail.IssueAsync(db, outbox, user, purpose, address, EmailPriority.Security, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("{Username} asked for another link to confirm {Email}", user.UserName, address);

        return await AccountEmail.DescribeAsync(db, outbox, user, now, cancellationToken);
    }
}
