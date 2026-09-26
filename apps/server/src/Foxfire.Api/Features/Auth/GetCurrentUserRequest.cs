using Foxfire.Api.Common;
using Foxfire.Api.Features.Account;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Auth;

/// <summary>
/// Who the caller is.
///
/// The roles come off the token, which is fifteen minutes old at most. The
/// address and whether it is confirmed come from the database: confirming is
/// something that happens in another tab — the link in an email — and a banner
/// asking somebody to confirm an address they confirmed a minute ago would say
/// the opposite of what is true until the token renewed.
/// </summary>
public sealed record GetCurrentUserRequest : IDomainRequest<MeResponse>;

internal sealed class GetCurrentUserRequestHandler(IIdentityContext me, FoxfireDbContext db, TimeProvider time)
    : IDomainRequestHandler<GetCurrentUserRequest, MeResponse>
{
    public async Task<Response<MeResponse>> Handle(GetCurrentUserRequest request, CancellationToken cancellationToken)
    {
        var user = me.UserId is { } id
            ? await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, cancellationToken)
            : null;

        if (user is null)
        {
            return Response<MeResponse>.Failure(
                new Error("unauthenticated", "Sign in again."),
                System.Net.HttpStatusCode.Unauthorized);
        }

        var pending = await AccountEmail.PendingChangeAsync(db, user, time.GetUtcNow(), cancellationToken);

        return new MeResponse(
            user.Id,
            user.UserName ?? me.Username ?? "",
            user.Email ?? me.Email ?? "",
            me.IsInRole(FoxfireRoles.Admin),
            me.IsInRole(FoxfireRoles.HeadAdmin),
            user.EmailConfirmed,
            pending?.Email);
    }
}
