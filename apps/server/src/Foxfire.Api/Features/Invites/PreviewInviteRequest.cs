using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>What the landing page and the desktop can learn about a token.</summary>
public sealed record InvitePreviewResponse(bool Usable, string ServerName, string? Email, string Message);

/// <summary>
/// Says whether a token can still be used, and for which address.
///
/// The email is given back here, unlike anywhere else, and only on a token that
/// verified against this server's signing key. Somebody holding a valid invite
/// already knows the address it was sent to — it is theirs — and the desktop
/// needs it to prefill the form so nobody registers with the wrong one and is
/// refused for reasons it cannot explain.
/// </summary>
public sealed record PreviewInviteRequest(string Token) : IDomainRequest<InvitePreviewResponse>;

internal sealed class PreviewInviteRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<PreviewInviteRequest, InvitePreviewResponse>
{
    public async Task<Response<InvitePreviewResponse>> Handle(
        PreviewInviteRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (invite, message) = await InviteLookup.ResolveAsync(
            request.Token, db, auth.Value, time, cancellationToken);

        return new InvitePreviewResponse(
            Usable: invite is not null,
            ServerName: server.Value.Name,
            Email: invite?.Email,
            Message: message);
    }
}
