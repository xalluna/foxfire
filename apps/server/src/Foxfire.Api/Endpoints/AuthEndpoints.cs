using System.Security.Claims;
using Foxfire.Api.Auth;
using Foxfire.Api.Configuration;
using Foxfire.Api.Services;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Endpoints;

public sealed record RegisterRequest(
    string Username,
    string Email,
    string Password,
    string? InviteToken,
    string? DeviceLabel);

public sealed record LoginRequest(string Email, string Password, string? DeviceLabel);

public sealed record RefreshRequest(string RefreshToken);

public sealed record SessionResponse(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt,
    MeResponse User);

public sealed record MeResponse(Guid Id, string Username, string Email, bool IsAdmin, bool EmailConfirmed);

/// <summary>
/// Registering, signing in, and staying signed in.
///
/// Email is the login and the username is the display name, which is the split
/// asked for: you cannot forget your email, a reset has to go to it anyway, and
/// what shows up next to your games should be yours to pick.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/auth").WithTags("Auth");

        auth.MapPost("/register", RegisterAsync);
        auth.MapPost("/login", LoginAsync);
        auth.MapPost("/refresh", RefreshAsync);
        auth.MapPost("/logout", LogoutAsync);
        auth.MapGet("/me", Me).RequireAuthorization();
    }

    /// <summary>
    /// Creates an account, if this server is letting anybody do that.
    ///
    /// Three ways in, checked in this order. The configured admin email is
    /// always allowed, so the owner can always claim their own server even with
    /// signup shut. Then public signup, if it is on. Then a valid, unspent
    /// invite for this exact address.
    ///
    /// The invite and the account are written in one transaction, and the invite
    /// is claimed by a conditional UPDATE rather than a read-then-write. That is
    /// what makes "clickable many times, redeemable once" true rather than merely
    /// likely: two people racing the same link both read it as open, and exactly
    /// one of them commits.
    /// </summary>
    private static async Task<IResult> RegisterAsync(
        [FromBody] RegisterRequest request,
        UserManager<FoxfireUser> users,
        FoxfireDbContext db,
        TokenService tokens,
        ServerSettingsService settings,
        IOptions<AuthOptions> authOptions,
        IOptions<AdminOptions> adminOptions,
        TimeProvider time,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var email = (request.Email ?? "").Trim();
        var username = (request.Username ?? "").Trim();

        if (username.Length is < 3 or > 32)
        {
            return Problem("invalid_username", "A username is 3 to 32 characters.");
        }

        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@', StringComparison.Ordinal))
        {
            return Problem("invalid_email", "That does not look like an email address.");
        }

        var isSeededAdmin = string.Equals(email, adminOptions.Value.Email.Trim(), StringComparison.OrdinalIgnoreCase);
        var publicSignup = await settings.IsPublicSignupEnabledAsync(cancellationToken);

        Invite? invite = null;
        if (!isSeededAdmin && !publicSignup)
        {
            var (resolved, inviteProblem) = await ResolveInviteAsync(
                request.InviteToken, email, db, authOptions.Value, time, cancellationToken);

            if (inviteProblem is not null) return inviteProblem;
            invite = resolved;
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
                    return (
                        Problem("registration_failed", string.Join(" ", created.Errors.Select(e => e.Description))),
                        (FoxfireUser?)null);
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
                            Problem("invite_already_used", "That invite has already been used."),
                            (FoxfireUser?)null);
                    }
                }

                await transaction.CommitAsync(ct);
                return ((IResult?)null, (FoxfireUser?)candidate);
            },
            cancellationToken);

        if (failure is not null || user is null) return failure ?? Results.Problem();

        logger.LogInformation(
            "Registered {Username} ({Email}){Admin}",
            username, email, isSeededAdmin ? " as this server's admin" : "");

        var roles = await users.GetRolesAsync(user);
        var pair = await tokens.IssueAsync(user, roles, request.DeviceLabel, cancellationToken);
        return Results.Ok(ToSession(pair, user, roles));
    }

    /// <summary>
    /// Checks an invite token against the row it names.
    ///
    /// Every failure answers the same way — "that invite is not usable" — with
    /// the specific reason only in the code. Telling an anonymous caller that a
    /// token is real but spent, or real but for a different address, hands them
    /// a way to enumerate who has been invited to a private server.
    /// </summary>
    private static async Task<(Invite? Invite, IResult? Failure)> ResolveInviteAsync(
        string? token,
        string email,
        FoxfireDbContext db,
        AuthOptions auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var closed = Problem(
            "invite_required",
            "This server is invite-only, and that invite is not usable.",
            StatusCodes.Status403Forbidden);

        var verified = InviteToken.Verify(token, auth.InviteSigningKeyBytes, time.GetUtcNow());
        if (verified.Status != InviteTokenStatus.Valid) return (null, closed);

        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Id == verified.InviteId, cancellationToken);
        if (invite is null || !invite.IsOpen(time.GetUtcNow())) return (null, closed);

        // The invite is for one address. A link forwarded to somebody else opens
        // nothing, which is what keeps a leaked link from being an open door.
        if (!string.Equals(invite.Email, email, StringComparison.OrdinalIgnoreCase)) return (null, closed);

        return (invite, null);
    }

    private static async Task<IResult> LoginAsync(
        [FromBody] LoginRequest request,
        UserManager<FoxfireUser> users,
        TokenService tokens,
        CancellationToken cancellationToken)
    {
        // One answer for "no such account" and "wrong password", so this cannot
        // be used to find out who has an account here.
        var wrong = Problem("invalid_credentials", "Wrong email or password.", StatusCodes.Status401Unauthorized);

        var user = await users.FindByEmailAsync((request.Email ?? "").Trim());
        if (user is null) return wrong;

        if (await users.IsLockedOutAsync(user))
        {
            return Problem(
                "account_disabled",
                "That account has been disabled by an administrator.",
                StatusCodes.Status403Forbidden);
        }

        if (!await users.CheckPasswordAsync(user, request.Password ?? ""))
        {
            // Feeds Identity's lockout accounting, which is what makes guessing
            // expensive rather than merely slow.
            await users.AccessFailedAsync(user);
            return wrong;
        }

        await users.ResetAccessFailedCountAsync(user);

        var roles = await users.GetRolesAsync(user);
        var pair = await tokens.IssueAsync(user, roles, request.DeviceLabel, cancellationToken);
        return Results.Ok(ToSession(pair, user, roles));
    }

    private static async Task<IResult> RefreshAsync(
        [FromBody] RefreshRequest request,
        TokenService tokens,
        UserManager<FoxfireUser> users,
        CancellationToken cancellationToken)
    {
        var pair = await tokens.RefreshAsync(request.RefreshToken, cancellationToken);
        if (pair is null)
        {
            return Problem(
                "invalid_refresh_token",
                "That session has ended. Sign in again.",
                StatusCodes.Status401Unauthorized);
        }

        // Re-read the account rather than trusting the old token's claims: roles
        // change, and a session that outlives a demotion should not.
        var handler = new Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler();
        var subject = handler.ReadJsonWebToken(pair.AccessToken).Subject;

        var user = await users.FindByIdAsync(subject);
        if (user is null)
        {
            return Problem(
                "invalid_refresh_token",
                "That session has ended. Sign in again.",
                StatusCodes.Status401Unauthorized);
        }

        var roles = await users.GetRolesAsync(user);
        return Results.Ok(ToSession(pair, user, roles));
    }

    private static async Task<IResult> LogoutAsync(
        [FromBody] RefreshRequest request,
        TokenService tokens,
        CancellationToken cancellationToken)
    {
        // Deliberately not authorized and deliberately silent about whether the
        // token meant anything. Signing out has to work when the access token
        // has already expired, which is most of the time.
        await tokens.RevokeAsync(request.RefreshToken, cancellationToken);
        return Results.NoContent();
    }

    private static IResult Me(ClaimsPrincipal principal)
    {
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(id, out var userId)) return Results.Unauthorized();

        return Results.Ok(new MeResponse(
            userId,
            principal.FindFirstValue(ClaimTypes.Name) ?? "",
            principal.FindFirstValue(ClaimTypes.Email) ?? "",
            principal.IsInRole(FoxfireRoles.Admin),
            EmailConfirmed: false));
    }

    private static SessionResponse ToSession(TokenPair pair, FoxfireUser user, IEnumerable<string> roles) =>
        new(pair.AccessToken,
            pair.AccessTokenExpiresAt,
            pair.RefreshToken,
            pair.RefreshTokenExpiresAt,
            new MeResponse(
                user.Id,
                user.UserName ?? "",
                user.Email ?? "",
                roles.Contains(FoxfireRoles.Admin),
                user.EmailConfirmed));

    internal static IResult Problem(string code, string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new { error = code, message }, statusCode: status);
}
