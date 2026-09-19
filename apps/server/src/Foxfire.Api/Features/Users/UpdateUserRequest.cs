using System.Text.Json.Serialization;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace Foxfire.Api.Features.Users;

/// <summary>
/// Make somebody an admin or stop, and stop them signing in or let them again.
///
/// Null leaves a field alone. Disabling is Identity's lockout with no end date
/// rather than a flag of our own — SignInManager already consults it on every
/// attempt, and a second boolean beside it would be a second answer to the
/// same question.
/// </summary>
public sealed record UpdateUserRequest(bool? IsAdmin, bool? IsDisabled) : IEmptyDomainRequest
{
    /// <summary>Who. From the route rather than the body, so it is not bound from JSON.</summary>
    [JsonIgnore]
    public Guid Id { get; init; }
}

internal sealed class UpdateUserRequestHandler(
    UserManager<FoxfireUser> users,
    TokenService tokens,
    FoxfireDbContext db,
    IIdentityContext me,
    ILogger<UpdateUserRequestHandler> logger)
    : IDomainRequestHandler<UpdateUserRequest>
{
    public async Task<Response> Handle(UpdateUserRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await users.FindByIdAsync(request.Id.ToString());
        if (user is null) return Response.NotFound();

        var wasAdmin = await users.IsInRoleAsync(user, FoxfireRoles.Admin);

        if (request.IsAdmin is false && wasAdmin && await Administrators.IsLastAsync(db, request.Id, cancellationToken))
        {
            return Response.Failure(Administrators.Last("demote"), Administrators.LastStatus);
        }

        if (request.IsDisabled is true && wasAdmin && await Administrators.IsLastAsync(db, request.Id, cancellationToken))
        {
            return Response.Failure(Administrators.Last("disable"), Administrators.LastStatus);
        }

        if (request.IsAdmin is { } shouldBeAdmin && shouldBeAdmin != wasAdmin)
        {
            if (shouldBeAdmin)
            {
                await users.AddToRoleAsync(user, FoxfireRoles.Admin);
            }
            else
            {
                await users.RemoveFromRoleAsync(user, FoxfireRoles.Admin);
            }

            // Roles live in the access token, which is not revocable and lasts
            // fifteen minutes. Cutting the sessions makes the change take effect
            // now rather than at some point in the next quarter of an hour —
            // which matters a great deal more for a demotion than a promotion.
            await tokens.RevokeAllAsync(request.Id, cancellationToken);

            logger.LogWarning(
                "{Actor} {Action} {Username}",
                me.Username,
                shouldBeAdmin ? "promoted" : "demoted",
                user.UserName);
        }

        if (request.IsDisabled is { } shouldBeDisabled)
        {
            await users.SetLockoutEndDateAsync(user, shouldBeDisabled ? DateTimeOffset.MaxValue : null);

            if (shouldBeDisabled)
            {
                // Otherwise they stay signed in on every machine they already
                // were: the lockout only guards signing in again.
                await tokens.RevokeAllAsync(request.Id, cancellationToken);
            }

            logger.LogWarning(
                "{Actor} {Action} {Username}",
                me.Username,
                shouldBeDisabled ? "disabled" : "re-enabled",
                user.UserName);
        }

        return Response.Success();
    }
}
