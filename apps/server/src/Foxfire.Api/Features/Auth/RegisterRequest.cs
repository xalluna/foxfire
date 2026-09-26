using System.Net;
using FluentValidation;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Services;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Auth;

/// <summary>
/// Creates an account, if this server is letting anybody do that.
///
/// Three ways in, checked in this order. The configured admin email is always
/// allowed, so the owner can always claim their own server even with signup
/// shut. Then public signup, if it is on. Then a valid, unspent invite for this
/// exact address.
/// </summary>
public sealed record RegisterRequest(
    string Username,
    string Email,
    string Password,
    string? InviteToken,
    string? DeviceLabel) : IValidatedRequest<SessionResponse>;

internal sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        // Stop at the first failing rule, which is what the hand-written checks
        // did by returning. Without it a registration with two problems answers
        // with the first code and both sentences.
        ClassLevelCascadeMode = CascadeMode.Stop;

        // Trimmed before measuring, because that is the value that gets stored.
        RuleFor(x => (x.Username ?? string.Empty).Trim())
            .Length(3, 32)
            .WithErrorCode("invalid_username")
            .WithMessage("A username is 3 to 32 characters.");

        RuleFor(x => (x.Email ?? string.Empty).Trim())
            .Must(email => !string.IsNullOrWhiteSpace(email) && email.Contains('@', StringComparison.Ordinal))
            .WithErrorCode("invalid_email")
            .WithMessage("That does not look like an email address.");
    }
}

internal sealed class RegisterRequestHandler(
    UserManager<FoxfireUser> users,
    FoxfireDbContext db,
    TokenService tokens,
    ServerSettingsService settings,
    IOptions<AuthOptions> authOptions,
    IOptions<AdminOptions> adminOptions,
    TimeProvider time,
    ILogger<RegisterRequestHandler> logger)
    : IValidatedRequestHandler<RegisterRequest, SessionResponse>
{
    /// <summary>
    /// Every invite failure answers the same way, with the specific reason only
    /// in the code. Telling an anonymous caller that a token is real but spent,
    /// or real but for a different address, hands them a way to enumerate who
    /// has been invited to a private server.
    /// </summary>
    private static Response<SessionResponse> Closed() =>
        Response<SessionResponse>.Failure(
            new Error("invite_required", "This server is invite-only, and that invite is not usable."),
            HttpStatusCode.Forbidden);

    public async Task<Response<SessionResponse>> Handle(
        RegisterRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var email = (request.Email ?? "").Trim();
        var username = (request.Username ?? "").Trim();

        var isSeededAdmin = string.Equals(email, adminOptions.Value.Email.Trim(), StringComparison.OrdinalIgnoreCase);
        var publicSignup = await settings.IsPublicSignupEnabledAsync(cancellationToken);

        Invite? invite = null;
        if (!isSeededAdmin && !publicSignup)
        {
            invite = await ResolveInviteAsync(request.InviteToken, email, cancellationToken);
            if (invite is null) return Closed();
        }

        var now = time.GetUtcNow();

        // The retrying execution strategy — which is there because a homelab's
        // SQL Server may still be starting when this process is — refuses to sit
        // inside a transaction it did not open. So the transaction goes inside it
        // and the whole block becomes the retriable unit.
        //
        // Only what must be atomic is in there. Issuing tokens is deliberately
        // left outside: a transient failure while minting them would otherwise
        // retry the whole block and try to create the account a second time,
        // which is a far worse outcome than one failed sign-in.
        var (failure, user) = await db.Database.CreateExecutionStrategy().ExecuteAsync(
            async ct =>
            {
                var candidate = new FoxfireUser
                {
                    Id = Guid.CreateVersion7(now),
                    UserName = username,
                    Email = email,
                    CreatedAt = now
                };

                await using var transaction = await db.Database.BeginTransactionAsync(ct);

                var created = await users.CreateAsync(candidate, request.Password ?? "");
                if (!created.Succeeded)
                {
                    await transaction.RollbackAsync(ct);

                    // A taken username gets its own code, because it is the one
                    // registration failure somebody fixes by changing a single
                    // box — and a code is what lets the desktop put the message
                    // under that box instead of in a banner.
                    var taken = created.Errors.Any(e => e.Code == "DuplicateUserName");

                    var error = taken
                        ? new Error("username_taken", "Somebody on this server already goes by that name.")
                        : new Error(
                            "registration_failed",
                            string.Join(" ", created.Errors.Select(e => e.Description)));

                    return ((Error?)error, (FoxfireUser?)null);
                }

                if (isSeededAdmin)
                {
                    await users.AddToRoleAsync(candidate, FoxfireRoles.Admin);
                }

                if (invite is not null)
                {
                    // A conditional UPDATE rather than a read-then-write. Both
                    // halves of a race read the invite as open a moment ago; this
                    // is the write that decides, because SQL Server serialises it
                    // on the row and the loser matches nothing.
                    var claimed = await db.Invites
                        .Where(i => i.Id == invite.Id && i.RedeemedAt == null && i.RevokedAt == null)
                        .ExecuteUpdateAsync(
                            setters => setters
                                .SetProperty(i => i.RedeemedByUserId, candidate.Id)
                                .SetProperty(i => i.RedeemedAt, (DateTimeOffset?)now),
                            ct);

                    if (claimed == 0)
                    {
                        // Somebody else got there first. The account goes back
                        // with the transaction, so they can try again with a
                        // different invite rather than finding a half-made
                        // account of their own in the way.
                        await transaction.RollbackAsync(ct);
                        return (
                            new Error("invite_already_used", "That invite has already been used."),
                            (FoxfireUser?)null);
                    }
                }

                await transaction.CommitAsync(ct);
                return ((Error?)null, (FoxfireUser?)candidate);
            },
            cancellationToken);

        if (failure is not null) return failure;
        if (user is null) return new Error("registration_failed", "The account could not be created.");

        logger.LogInformation(
            "Registered {Username} ({Email}){Admin}",
            username, email, isSeededAdmin ? " as this server's admin" : "");

        var roles = await users.GetRolesAsync(user);
        var pair = await tokens.IssueAsync(user, roles, request.DeviceLabel, cancellationToken);

        return Sessions.Describe(pair, user, roles);
    }

    /// <summary>The invite this token names, if it is usable by this address.</summary>
    private async Task<Invite?> ResolveInviteAsync(
        string? token,
        string email,
        CancellationToken cancellationToken)
    {
        var verified = InviteToken.Verify(token, authOptions.Value.InviteSigningKeyBytes, time.GetUtcNow());
        if (verified.Status != SignedTokenStatus.Valid) return null;

        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Id == verified.InviteId, cancellationToken);
        if (invite is null || !invite.IsOpen(time.GetUtcNow())) return null;

        // An invite without an address is for whoever opens it first. One with an
        // address registers only that address.
        return invite.Email is null || string.Equals(invite.Email, email, StringComparison.OrdinalIgnoreCase)
            ? invite
            : null;
    }
}
