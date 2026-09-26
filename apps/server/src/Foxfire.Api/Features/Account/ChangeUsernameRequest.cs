using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Features.Auth;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// Changing the name shown beside your games.
///
/// No password for this one. A username is a display name — it is not what
/// anybody signs in with, and taking one over gains somebody nothing that
/// holding the session did not already gain them. It is unique on the server,
/// so the one refusal worth its own code is that somebody else has it.
/// </summary>
public sealed record ChangeUsernameRequest(string Username) : IValidatedRequest<MeResponse>;

internal sealed class ChangeUsernameRequestValidator : AbstractValidator<ChangeUsernameRequest>
{
    public ChangeUsernameRequestValidator()
    {
        ClassLevelCascadeMode = CascadeMode.Stop;

        RuleFor(x => (x.Username ?? string.Empty).Trim())
            .Length(3, 32)
            .WithErrorCode("invalid_username")
            .WithMessage("A username is 3 to 32 characters.");
    }
}

internal sealed class ChangeUsernameRequestHandler(
    UserManager<FoxfireUser> users,
    IIdentityContext me,
    ILogger<ChangeUsernameRequestHandler> logger)
    : IValidatedRequestHandler<ChangeUsernameRequest, MeResponse>
{
    public async Task<Response<MeResponse>> Handle(
        ChangeUsernameRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await Accounts.SignedInAsync(users, me);
        if (user is null) return Accounts.SignedOut<MeResponse>();

        var username = (request.Username ?? "").Trim();
        var previous = user.UserName;

        var set = await users.SetUserNameAsync(user, username);
        if (!set.Succeeded)
        {
            return set.Errors.Any(e => e.Code == "DuplicateUserName")
                ? new Error("username_taken", "Somebody on this server already goes by that name.")
                : Accounts.Refused(set, "username_change_failed");
        }

        logger.LogInformation("{Previous} is now called {Username}", previous, username);

        var roles = await users.GetRolesAsync(user);

        return new MeResponse(
            user.Id,
            user.UserName ?? "",
            user.Email ?? "",
            roles.Contains(FoxfireRoles.Admin),
            roles.Contains(FoxfireRoles.HeadAdmin),
            user.EmailConfirmed);
    }
}
