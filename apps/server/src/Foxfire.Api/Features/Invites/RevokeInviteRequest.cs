using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Invites;

/// <summary>
/// Withdraws an invite that has not been used.
///
/// The row survives, revoked rather than deleted, so that whoever finally
/// clicks the link is told it was withdrawn instead of being told it never
/// existed — which is what a forged token gets, and is a different thing.
/// </summary>
public sealed record RevokeInviteRequest(Guid Id) : IEmptyDomainRequest;

internal sealed class RevokeInviteRequestHandler(
    FoxfireDbContext db,
    TimeProvider time,
    ILogger<RevokeInviteRequestHandler> logger)
    : IDomainRequestHandler<RevokeInviteRequest>
{
    public async Task<Response> Handle(RevokeInviteRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);
        if (invite is null) return Response.NotFound();

        if (invite.RedeemedAt is not null)
        {
            return new Error(
                "invite_already_used", "That invite has already been used, so there is nothing to withdraw.");
        }

        if (invite.RevokedAt is null)
        {
            invite.RevokedAt = time.GetUtcNow();
            await db.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Withdrew invite {InviteId}", invite.Id);
        }

        return Response.Success();
    }
}
