using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Email;

/// <summary>
/// Lets mail go to an address again — somebody fixed their mailbox, or the
/// bounce was a fluke. If it bounces hard again it goes straight back.
/// </summary>
public sealed record ClearEmailSuppressionRequest(Guid Id) : IEmptyDomainRequest;

internal sealed class ClearEmailSuppressionRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    ILogger<ClearEmailSuppressionRequestHandler> logger)
    : IDomainRequestHandler<ClearEmailSuppressionRequest>
{
    public async Task<Response> Handle(ClearEmailSuppressionRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var suppression = await db.EmailSuppressions.FirstOrDefaultAsync(s => s.Id == request.Id, cancellationToken);
        if (suppression is null) return Response.NotFound();

        db.EmailSuppressions.Remove(suppression);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogWarning(
            "{Actor} let email go to {Address} again, which had been stopped after a {Reason}",
            me.Username, suppression.Address, suppression.Reason);

        return Response.Success();
    }
}
