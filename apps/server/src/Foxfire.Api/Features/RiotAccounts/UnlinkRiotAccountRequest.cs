using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>Gives up your own claim. The account and its games stay.</summary>
public sealed record UnlinkRiotAccountRequest(Guid Id) : IEmptyDomainRequest;

internal sealed class UnlinkRiotAccountRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IDomainRequestHandler<UnlinkRiotAccountRequest>
{
    public async Task<Response> Handle(UnlinkRiotAccountRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == request.Id, cancellationToken);

        if (account is null) return Response.NotFound();
        if (account.OwnerId != me.UserId)
        {
            return Response.Failure(AccountOwnership.NotYours, HttpStatusCode.Forbidden);
        }

        account.OwnerId = null;
        account.LinkedAt = null;
        await db.SaveChangesAsync(cancellationToken);

        return Response.Success();
    }
}

/// <summary>
/// The escape hatch that makes first-writer-wins liveable.
///
/// Somebody claims an account that is not theirs, or leaves the community still
/// holding one, or mistypes into a smurf nobody can now claim. Without this,
/// every one of those is permanent.
/// </summary>
public sealed record ForceUnlinkRiotAccountRequest(Guid Id) : IEmptyDomainRequest;

internal sealed class ForceUnlinkRiotAccountRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    ILogger<ForceUnlinkRiotAccountRequestHandler> logger)
    : IDomainRequestHandler<ForceUnlinkRiotAccountRequest>
{
    public async Task<Response> Handle(
        ForceUnlinkRiotAccountRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.Id == request.Id, cancellationToken);
        if (account is null) return Response.NotFound();

        // Already nobody's — another admin got there first. Nothing to write,
        // and nothing to say in the log.
        if (account.OwnerId is null) return Response.Success();

        var previous = account.Owner?.UserName ?? account.OwnerId.ToString();
        account.OwnerId = null;
        account.LinkedAt = null;
        await db.SaveChangesAsync(cancellationToken);

        logger.LogWarning("{Actor} unlinked {RiotId} from {Username}", me.Username, account.RiotId, previous);

        return Response.Success();
    }
}
