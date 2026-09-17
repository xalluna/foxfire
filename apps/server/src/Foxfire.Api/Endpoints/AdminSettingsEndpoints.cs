using Foxfire.Api.Services;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>What an admin may change while the server is running.</summary>
/// <param name="PublicSignup">Null leaves it alone.</param>
/// <param name="BackfillTarget">Null leaves it alone.</param>
public sealed record UpdateServerSettingsRequest(bool? PublicSignup, int? BackfillTarget);

/// <summary>The current state of those switches.</summary>
public sealed record ServerSettingsResponse(bool PublicSignup, int BackfillTarget);

/// <summary>
/// The switches behind the server management section of the desktop's settings.
///
/// Deliberately short, and deliberately not where secrets live. The Riot API
/// key, the connection strings and the signing keys are environment
/// configuration — changing one is an edit and a restart, not a button. What is
/// here is what can safely change underneath a running server.
/// </summary>
public static class AdminSettingsEndpoints
{
    public static void MapAdminSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/settings")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", async (ServerSettingsService settings, CancellationToken cancellationToken) =>
            Results.Ok(new ServerSettingsResponse(
                await settings.IsPublicSignupEnabledAsync(cancellationToken),
                await settings.GetBackfillTargetAsync(cancellationToken))));

        admin.MapPatch("/", async (
            [FromBody] UpdateServerSettingsRequest request,
            ServerSettingsService settings,
            ILogger<Program> logger,
            CancellationToken cancellationToken) =>
        {
            if (request.BackfillTarget is { } target && target is < 1 or > 1000)
            {
                return AuthEndpoints.Problem(
                    "invalid_backfill_target",
                    "A backfill target is between 1 and 1000 matches. Remember it is roughly one Riot "
                    + "request per match, out of about a hundred every two minutes for the whole server.");
            }

            if (request.PublicSignup is { } publicSignup)
            {
                await settings.SetPublicSignupAsync(publicSignup, cancellationToken);
                logger.LogInformation(
                    "Public signup is now {State}", publicSignup ? "open" : "closed — invites only");
            }

            if (request.BackfillTarget is { } value)
            {
                await settings.SetBackfillTargetAsync(value, cancellationToken);
                logger.LogInformation("Backfill target is now {Target} matches", value);
            }

            return Results.Ok(new ServerSettingsResponse(
                await settings.IsPublicSignupEnabledAsync(cancellationToken),
                await settings.GetBackfillTargetAsync(cancellationToken)));
        });
    }
}
