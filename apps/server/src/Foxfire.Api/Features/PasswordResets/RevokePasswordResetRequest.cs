using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.PasswordResets;

/// <summary>
/// Withdraws whatever reset link is outstanding for somebody.
///
/// For the link that went to the wrong window, or to the wrong person. The row
/// survives, revoked rather than deleted, so that whoever finally opens the
/// link is told it was withdrawn instead of being told it never existed —
/// which is what a forged token gets, and is a different thing.
///
/// Withdrawing nothing is not an error. The button only appears when a link is
/// outstanding, so getting here with none means it was used or replaced a
/// moment ago, and the answer to "make sure there is no live link" is still yes.
/// </summary>
public sealed record RevokePasswordResetRequest(Guid UserId) : IEmptyDomainRequest;

internal sealed class RevokePasswordResetRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    TimeProvider time,
    ILogger<RevokePasswordResetRequestHandler> logger)
    : IDomainRequestHandler<RevokePasswordResetRequest>
{
    public async Task<Response> Handle(RevokePasswordResetRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user is null) return Response.NotFound();

        var now = time.GetUtcNow();

        var withdrawn = await db.PasswordResets
            .Where(r => r.UserId == user.Id && r.RedeemedAt == null && r.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, (DateTimeOffset?)now), cancellationToken);

        if (withdrawn > 0)
        {
            logger.LogWarning("{Actor} withdrew the password reset link for {Username}", me.Username, user.UserName);
        }

        return Response.Success();
    }
}
