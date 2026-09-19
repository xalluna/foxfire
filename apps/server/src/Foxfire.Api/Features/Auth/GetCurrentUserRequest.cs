using Foxfire.Api.Common;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Features.Auth;

/// <summary>
/// Who the caller is, read off the token rather than out of the database.
///
/// No query, deliberately. Everything on this answer is already in the access
/// token, which is fifteen minutes old at most, and the desktop calls this on
/// every reconnect — a round trip to SQL Server to repeat what the token just
/// said would be work nobody asked for.
/// </summary>
public sealed record GetCurrentUserRequest : IDomainRequest<MeResponse>;

internal sealed class GetCurrentUserRequestHandler(IIdentityContext me)
    : IDomainRequestHandler<GetCurrentUserRequest, MeResponse>
{
    public Task<Response<MeResponse>> Handle(GetCurrentUserRequest request, CancellationToken cancellationToken)
    {
        if (me.UserId is not { } id)
        {
            return Task.FromResult(Response<MeResponse>.Failure(
                new Error("unauthenticated", "Sign in again."),
                System.Net.HttpStatusCode.Unauthorized));
        }

        return Task.FromResult<Response<MeResponse>>(new MeResponse(
            id,
            me.Username ?? "",
            me.Email ?? "",
            me.IsInRole(FoxfireRoles.Admin),
            EmailConfirmed: false));
    }
}
