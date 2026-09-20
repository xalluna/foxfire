using Foxfire.Api.Auth;
using Foxfire.Api.Common;

namespace Foxfire.Api.Features.Auth;

/// <summary>
/// Ending a session.
///
/// Deliberately not authorized and deliberately silent about whether the token
/// meant anything. Signing out has to work when the access token has already
/// expired, which is most of the time.
/// </summary>
public sealed record LogoutRequest(string RefreshToken) : IEmptyDomainRequest;

internal sealed class LogoutRequestHandler(TokenService tokens) : IDomainRequestHandler<LogoutRequest>
{
    public async Task<Response> Handle(LogoutRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        await tokens.RevokeAsync(request.RefreshToken, cancellationToken);
        return Response.Success();
    }
}
