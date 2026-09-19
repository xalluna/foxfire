using System.Net;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Foxfire.Api.Features.Auth;

/// <summary>The long-lived half of a session, traded for a fresh pair.</summary>
public sealed record RefreshSessionRequest(string RefreshToken) : IDomainRequest<SessionResponse>;

internal sealed class RefreshSessionRequestHandler(TokenService tokens, UserManager<FoxfireUser> users)
    : IDomainRequestHandler<RefreshSessionRequest, SessionResponse>
{
    private static Response<SessionResponse> Ended() =>
        Response<SessionResponse>.Failure(
            new Error("invalid_refresh_token", "That session has ended. Sign in again."),
            HttpStatusCode.Unauthorized);

    public async Task<Response<SessionResponse>> Handle(
        RefreshSessionRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var pair = await tokens.RefreshAsync(request.RefreshToken, cancellationToken);
        if (pair is null) return Ended();

        // Re-read the account rather than trusting the old token's claims: roles
        // change, and a session that outlives a demotion should not.
        var subject = new JsonWebTokenHandler().ReadJsonWebToken(pair.AccessToken).Subject;

        var user = await users.FindByIdAsync(subject);
        if (user is null) return Ended();

        var roles = await users.GetRolesAsync(user);
        return Sessions.Describe(pair, user, roles);
    }
}
