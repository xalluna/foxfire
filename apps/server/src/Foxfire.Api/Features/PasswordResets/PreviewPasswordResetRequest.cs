using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.PasswordResets;

/// <summary>What the page behind a reset link can learn about the token it was opened with.</summary>
public sealed record PasswordResetPreviewResponse(
    bool Usable,
    string ServerName,
    string? Username,
    string? Email,
    string Message);

/// <summary>
/// Says whether a link can still be used, and whose account it sets.
///
/// The name and address come back only for a token that verified against this
/// server's key and names a live reset. Whoever holds such a link can set that
/// password in the next breath, so telling them which account they are about to
/// change reveals nothing they could not have found out by using it — and not
/// saying would leave somebody typing a new password with no idea whose it is.
/// </summary>
public sealed record PreviewPasswordResetRequest(string Token) : IDomainRequest<PasswordResetPreviewResponse>;

internal sealed class PreviewPasswordResetRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<PreviewPasswordResetRequest, PasswordResetPreviewResponse>
{
    public async Task<Response<PasswordResetPreviewResponse>> Handle(
        PreviewPasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (reset, message) = await PasswordResetLookup.ResolveAsync(
            request.Token, db, auth.Value, time, cancellationToken);

        return new PasswordResetPreviewResponse(
            Usable: reset is not null,
            ServerName: server.Value.Name,
            Username: reset?.User?.UserName,
            Email: reset?.User?.Email,
            Message: message);
    }
}
