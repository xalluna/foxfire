using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Features.Auth;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// Changing the address you sign in with.
///
/// The current password is asked for the same reason it is for a password
/// change, and rather more urgently: the email is the login, so moving it moves
/// the account.
///
/// Sessions are left alone. Nothing another device holds has stopped being true
/// — the password did not change — and their tokens carry the new address after
/// a renewal.
///
/// Admin__Email is the exception, both ways round. Registering with that
/// address makes a head admin even on a server with signup shut, and the
/// configured address is re-granted it on every boot, so it is a claim on the
/// server rather than an ordinary address. The account holding it cannot move
/// off it here, because that would leave the claim unheld for anybody to take,
/// and nobody who is not already a head admin can move onto it — for a plain
/// admin, the next restart would be a promotion nobody gave them.
/// </summary>
public sealed record ChangeEmailRequest(string Email, string CurrentPassword) : IValidatedRequest<MeResponse>;

internal sealed class ChangeEmailRequestValidator : AbstractValidator<ChangeEmailRequest>
{
    public ChangeEmailRequestValidator()
    {
        ClassLevelCascadeMode = CascadeMode.Stop;

        // Trimmed before measuring, because that is the value that gets stored.
        // The same rule and the same sentence as registration.
        RuleFor(x => (x.Email ?? string.Empty).Trim())
            .Must(email => !string.IsNullOrWhiteSpace(email) && email.Contains('@', StringComparison.Ordinal))
            .WithErrorCode("invalid_email")
            .WithMessage("That does not look like an email address.");
    }
}

internal sealed class ChangeEmailRequestHandler(
    UserManager<FoxfireUser> users,
    IIdentityContext me,
    IOptions<AdminOptions> adminOptions,
    ILogger<ChangeEmailRequestHandler> logger)
    : IValidatedRequestHandler<ChangeEmailRequest, MeResponse>
{
    public async Task<Response<MeResponse>> Handle(ChangeEmailRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await Accounts.SignedInAsync(users, me);
        if (user is null) return Accounts.SignedOut<MeResponse>();

        if (!await users.CheckPasswordAsync(user, request.CurrentPassword ?? ""))
        {
            return Accounts.WrongPassword;
        }

        var email = (request.Email ?? "").Trim();
        var configured = adminOptions.Value.Email;

        if (Accounts.IsConfiguredAdmin(user.Email, configured))
        {
            return new Error(
                "admin_email_pinned",
                "This server's configuration names your address as its administrator, so it is set there "
                + "rather than here. Change Admin__Email and restart the server to move it.");
        }

        if (Accounts.IsConfiguredAdmin(email, configured) && !me.IsInRole(FoxfireRoles.HeadAdmin))
        {
            return new Error("admin_email_reserved", "That address is reserved for this server's administrator.");
        }

        var previous = user.Email;

        // Identity checks uniqueness here, clears EmailConfirmed, and rotates
        // the security stamp — which also ends any outstanding reset link for
        // this account, since a reset is pinned to the stamp it was issued on.
        var set = await users.SetEmailAsync(user, email);
        if (!set.Succeeded)
        {
            return set.Errors.Any(e => e.Code == "DuplicateEmail")
                ? new Error("email_taken", "Somebody on this server already signs in with that address.")
                : Accounts.Refused(set, "email_change_failed");
        }

        logger.LogInformation(
            "{Username} changed their email from {Previous} to {Email}", user.UserName, previous, email);

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
