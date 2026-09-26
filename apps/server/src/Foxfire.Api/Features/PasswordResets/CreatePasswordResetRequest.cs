using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Features.Users;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.PasswordResets;

/// <summary>
/// Makes a link that lets somebody set a new password.
///
/// This server sends no mail, so a reset cannot be posted to the address on the
/// account: an admin makes the link and sends it however their community talks.
/// That is the same arrangement as invites, and it has the same consequence —
/// whoever holds the link can set the password, so it is short-lived, single
/// use, and there is never more than one of them outstanding per account.
///
/// Making one changes nothing about the account. The old password keeps working
/// until somebody actually uses the link, which is what keeps this from being a
/// way to lock a member out by accident.
///
/// A link for another admin is a head admin's to make. Whoever holds it can
/// become that admin, so from a plain admin it would be a way round every rule
/// that keeps admins from acting against each other. The head admin in
/// Admin__Email can still be sent one — by another head admin — since that is
/// how they get back in when they forget their password.
/// </summary>
public sealed record CreatePasswordResetRequest(Guid UserId) : IDomainRequest<PasswordResetResponse>;

internal sealed class CreatePasswordResetRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time,
    ILogger<CreatePasswordResetRequestHandler> logger)
    : IDomainRequestHandler<CreatePasswordResetRequest, PasswordResetResponse>
{
    public async Task<Response<PasswordResetResponse>> Handle(
        CreatePasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user is null) return Response<PasswordResetResponse>.NotFound();

        if (user.Id != me.UserId && !me.IsInRole(FoxfireRoles.HeadAdmin) && await IsAdminAsync(user.Id, cancellationToken))
        {
            return Response<PasswordResetResponse>.Failure(
                Administrators.HeadAdminOnly("make a reset link for another admin"),
                Administrators.HeadAdminOnlyStatus);
        }

        var now = time.GetUtcNow();

        if (PasswordResetLookup.IsDisabled(user, now))
        {
            return new Error(
                "account_disabled",
                $"{user.UserName} is disabled, so a reset link would not get them in. Enable them first.");
        }

        // One live link per account. Whatever was outstanding is withdrawn here
        // rather than left to expire, so a link that has been sitting in a chat
        // for a day stops working the moment a newer one is made.
        await db.PasswordResets
            .Where(r => r.UserId == user.Id && r.RedeemedAt == null && r.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, (DateTimeOffset?)now), cancellationToken);

        var reset = new PasswordReset
        {
            Id = Guid.CreateVersion7(now),
            UserId = user.Id,
            CreatedByUserId = me.UserId,
            CreatedAt = now,
            ExpiresAt = now + auth.Value.PasswordResetLifetime,
            SecurityStamp = user.SecurityStamp ?? ""
        };

        db.PasswordResets.Add(reset);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogWarning("{Actor} made a password reset link for {Username}", me.Username, user.UserName);

        return PasswordResetLookup.Describe(reset, server.Value, auth.Value);
    }

    private Task<bool> IsAdminAsync(Guid userId, CancellationToken cancellationToken) =>
        db.UserRoles.AnyAsync(
            ur => ur.UserId == userId && db.Roles.Any(r => r.Id == ur.RoleId && r.Name == FoxfireRoles.Admin),
            cancellationToken);
}
