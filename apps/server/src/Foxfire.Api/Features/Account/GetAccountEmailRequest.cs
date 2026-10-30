using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// Whether your address is confirmed, and whether you are moving to another —
/// what the banner and the account settings are drawn from.
/// </summary>
public sealed record GetAccountEmailRequest : IDomainRequest<AccountEmailResponse>;

internal sealed class GetAccountEmailRequestHandler(
    UserManager<FoxfireUser> users,
    FoxfireDbContext db,
    EmailOutbox outbox,
    IOptions<AdminOptions> adminOptions,
    IIdentityContext me,
    TimeProvider time)
    : IDomainRequestHandler<GetAccountEmailRequest, AccountEmailResponse>
{
    public async Task<Response<AccountEmailResponse>> Handle(
        GetAccountEmailRequest request,
        CancellationToken cancellationToken)
    {
        var user = await Accounts.SignedInAsync(users, me);
        if (user is null) return Accounts.SignedOut<AccountEmailResponse>();

        return await AccountEmail.DescribeAsync(db, outbox, user, adminOptions.Value.Email, time.GetUtcNow(), cancellationToken);
    }
}
