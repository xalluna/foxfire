using Foxfire.Api.Common;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// Stops a move to a new address that has not been confirmed — the wrong
/// address typed, or a change of mind. The link already sent stops working.
/// Nothing to cancel is not an error: the answer to "make sure I am not
/// moving" is still yes.
/// </summary>
public sealed record CancelEmailChangeRequest : IDomainRequest<AccountEmailResponse>;

internal sealed class CancelEmailChangeRequestHandler(
    UserManager<FoxfireUser> users,
    FoxfireDbContext db,
    EmailOutbox outbox,
    IIdentityContext me,
    TimeProvider time,
    ILogger<CancelEmailChangeRequestHandler> logger)
    : IDomainRequestHandler<CancelEmailChangeRequest, AccountEmailResponse>
{
    public async Task<Response<AccountEmailResponse>> Handle(
        CancelEmailChangeRequest request,
        CancellationToken cancellationToken)
    {
        var user = await Accounts.SignedInAsync(users, me);
        if (user is null) return Accounts.SignedOut<AccountEmailResponse>();

        var now = time.GetUtcNow();

        var open = await db.EmailVerifications
            .Where(v => v.UserId == user.Id && v.Purpose == EmailVerificationPurposes.Change)
            .Where(v => v.RedeemedAt == null && v.RevokedAt == null)
            .Select(v => v.Id)
            .ToListAsync(cancellationToken);

        if (open.Count > 0)
        {
            await db.EmailVerifications
                .Where(v => open.Contains(v.Id))
                .ExecuteUpdateAsync(s => s.SetProperty(v => v.RevokedAt, (DateTimeOffset?)now), cancellationToken);

            foreach (var id in open) await outbox.WithdrawAsync(EmailKinds.EmailChange, id, "revoked", cancellationToken);

            logger.LogInformation("{Username} cancelled moving to a new email address", user.UserName);
        }

        return await AccountEmail.DescribeAsync(db, outbox, user, now, cancellationToken);
    }
}
