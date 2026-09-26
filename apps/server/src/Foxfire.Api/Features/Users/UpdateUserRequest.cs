using System.Text.Json.Serialization;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Features.Account;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Users;

/// <summary>
/// Make somebody an admin or a head admin or stop, and stop them signing in or
/// let them again.
///
/// Null leaves a field alone. The roles nest: making somebody a head admin makes
/// them an admin too, and demoting them from admin takes head admin with it, so
/// the one combination refused is asking for both at once the wrong way round.
///
/// Disabling is Identity's lockout with no end date rather than a flag of our
/// own — SignInManager already consults it on every attempt, and a second
/// boolean beside it would be a second answer to the same question.
/// </summary>
public sealed record UpdateUserRequest(bool? IsAdmin, bool? IsHeadAdmin, bool? IsDisabled) : IEmptyDomainRequest
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
    IOptions<AdminOptions> adminOptions,
    ILogger<UpdateUserRequestHandler> logger)
    : IDomainRequestHandler<UpdateUserRequest>
{
    public async Task<Response> Handle(UpdateUserRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request is { IsAdmin: false, IsHeadAdmin: true })
        {
            return new Error("invalid_roles", "A head admin is an admin as well, so nobody can be one without the other.");
        }

        var user = await users.FindByIdAsync(request.Id.ToString());
        if (user is null) return Response.NotFound();

        var roles = await users.GetRolesAsync(user);
        var wasAdmin = roles.Contains(FoxfireRoles.Admin);
        var wasHeadAdmin = roles.Contains(FoxfireRoles.HeadAdmin);

        var shouldBeAdmin = request.IsHeadAdmin is true || (request.IsAdmin ?? wasAdmin);
        var shouldBeHeadAdmin = request.IsAdmin is not false && (request.IsHeadAdmin ?? wasHeadAdmin);

        var losesAdmin = wasAdmin && !shouldBeAdmin;
        var losesHeadAdmin = wasHeadAdmin && !shouldBeHeadAdmin;
        var disabling = request.IsDisabled is true;
        var username = user.UserName ?? "";

        if (Accounts.IsConfiguredAdmin(user.Email, adminOptions.Value.Email))
        {
            if (losesAdmin || losesHeadAdmin)
            {
                return Response.Failure(Administrators.Configured(username, "demoted"), Administrators.ConfiguredStatus);
            }

            if (disabling)
            {
                return Response.Failure(Administrators.Configured(username, "disabled"), Administrators.ConfiguredStatus);
            }
        }

        if (!me.IsInRole(FoxfireRoles.HeadAdmin))
        {
            var isYou = me.UserId == user.Id;

            if (losesAdmin && !isYou)
            {
                return Response.Failure(
                    Administrators.HeadAdminOnly("demote another admin"), Administrators.HeadAdminOnlyStatus);
            }

            if (disabling && wasAdmin && !isYou)
            {
                return Response.Failure(
                    Administrators.HeadAdminOnly("disable another admin"), Administrators.HeadAdminOnlyStatus);
            }

            if (shouldBeHeadAdmin != wasHeadAdmin)
            {
                return Response.Failure(
                    Administrators.HeadAdminOnly("make somebody a head admin, or stop them being one"),
                    Administrators.HeadAdminOnlyStatus);
            }
        }

        var last = await Administrators.LastHolderAsync(
            db, user.Id, "demote", losesAdmin, losesHeadAdmin, cancellationToken);
        if (last is null && disabling)
        {
            last = await Administrators.LastHolderAsync(
                db, user.Id, "disable", wasAdmin, wasHeadAdmin, cancellationToken);
        }

        if (last is not null) return Response.Failure(last, Administrators.LastStatus);

        if (shouldBeAdmin != wasAdmin || shouldBeHeadAdmin != wasHeadAdmin)
        {
            // Added outermost first and removed innermost first, so that nobody
            // is ever a head admin without being an admin, even between the two.
            if (shouldBeAdmin && !wasAdmin) await users.AddToRoleAsync(user, FoxfireRoles.Admin);
            if (shouldBeHeadAdmin && !wasHeadAdmin) await users.AddToRoleAsync(user, FoxfireRoles.HeadAdmin);
            if (losesHeadAdmin) await users.RemoveFromRoleAsync(user, FoxfireRoles.HeadAdmin);
            if (losesAdmin) await users.RemoveFromRoleAsync(user, FoxfireRoles.Admin);

            // Roles live in the access token, which is not revocable and lasts
            // fifteen minutes. Cutting the sessions makes the change take effect
            // now rather than at some point in the next quarter of an hour —
            // which matters a great deal more for a demotion than a promotion.
            await tokens.RevokeAllAsync(request.Id, cancellationToken);

            logger.LogWarning(
                "{Actor} made {Username} {Role}",
                me.Username,
                username,
                shouldBeHeadAdmin ? "a head admin" : shouldBeAdmin ? "an admin" : "a member");
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
                username);
        }

        return Response.Success();
    }
}
