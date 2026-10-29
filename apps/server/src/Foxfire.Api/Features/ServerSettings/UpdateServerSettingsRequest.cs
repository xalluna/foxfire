using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Services;
using Foxfire.Core;

namespace Foxfire.Api.Features.ServerSettings;

/// <summary>
/// What an admin may change while the server is running.
///
/// Every field is optional and null leaves that switch alone, which is what
/// makes this a PATCH rather than a PUT — the desktop's settings screen sends
/// the one control somebody touched.
/// </summary>
/// <param name="PublicSignup">Null leaves it alone.</param>
/// <param name="BackfillTarget">Null leaves it alone.</param>
/// <param name="ReplayByteCap">Null leaves it alone. Zero removes the cap.</param>
/// <param name="TftBackfillTarget">Null leaves it alone.</param>
/// <param name="PublicAccess">Null leaves it alone.</param>
/// <param name="BackgroundSync">Null leaves it alone.</param>
/// <param name="BackgroundSyncMinutes">Null leaves it alone.</param>
/// <param name="BackgroundSyncSkipMinutes">
/// Null leaves it alone. Checked against the interval in the same request, or
/// the stored one when the request leaves that alone.
/// </param>
public sealed record UpdateServerSettingsRequest(
    bool? PublicSignup,
    int? BackfillTarget,
    long? ReplayByteCap,
    int? TftBackfillTarget = null,
    bool? PublicAccess = null,
    bool? BackgroundSync = null,
    int? BackgroundSyncMinutes = null,
    int? BackgroundSyncSkipMinutes = null) : IValidatedRequest<ServerSettingsResponse>;

internal sealed class UpdateServerSettingsRequestHandler(
    ServerSettingsService settings,
    IIdentityContext me,
    ILogger<UpdateServerSettingsRequestHandler> logger)
    : IValidatedRequestHandler<UpdateServerSettingsRequest, ServerSettingsResponse>
{
    public async Task<Response<ServerSettingsResponse>> Handle(
        UpdateServerSettingsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Nothing is written until everything has been checked, which the
        // endpoint this replaces did not manage: it stored the replay cap
        // before looking at the backfill target, so a request carrying a good
        // cap and a bad target was refused with the cap already changed.
        // Moving the rules into a validator fixes that by construction.
        if (request.PublicSignup is { } publicSignup)
        {
            await settings.SetPublicSignupAsync(publicSignup, cancellationToken);
            logger.LogInformation(
                "Public signup is now {State}", publicSignup ? "open" : "closed — invites only");
        }

        if (request.PublicAccess is { } publicAccess)
        {
            await settings.SetPublicAccessAsync(publicAccess, cancellationToken);
            logger.LogInformation(
                "{Admin} made reading this server {State}",
                me.Username,
                publicAccess ? "open to anybody, signed in or not" : "members only");
        }

        if (request.BackfillTarget is { } target)
        {
            await settings.SetBackfillTargetAsync(target, cancellationToken);
            logger.LogInformation("Backfill target is now {Target} matches", target);
        }

        if (request.ReplayByteCap is { } cap)
        {
            await settings.SetReplayByteCapAsync(cap, cancellationToken);
        }

        if (request.TftBackfillTarget is { } tftTarget)
        {
            await settings.SetTftBackfillTargetAsync(tftTarget, cancellationToken);
            logger.LogInformation("TFT backfill target is now {Target} matches", tftTarget);
        }

        if (request.BackgroundSync is { } backgroundSync)
        {
            await settings.SetBackgroundSyncAsync(backgroundSync, cancellationToken);
        }

        if (request.BackgroundSyncMinutes is { } minutes)
        {
            await settings.SetBackgroundSyncMinutesAsync(minutes, cancellationToken);
        }

        if (request.BackgroundSyncSkipMinutes is { } skipMinutes)
        {
            await settings.SetBackgroundSyncSkipMinutesAsync(skipMinutes, cancellationToken);
        }

        // One line for the three, saying where they ended up: a host reading
        // the log back wants to know what the server is doing now, not which
        // of the fields one request happened to carry.
        if (request.BackgroundSync is not null
            || request.BackgroundSyncMinutes is not null
            || request.BackgroundSyncSkipMinutes is not null)
        {
            var now = await settings.GetBackgroundSyncAsync(cancellationToken);
            logger.LogInformation(
                "{Admin} set background sync {State}, every {Minutes} minutes, leaving alone accounts synced in the last {SkipMinutes} minutes",
                me.Username,
                now.Enabled ? "on" : "off",
                now.Interval.TotalMinutes,
                now.Skip.TotalMinutes);
        }

        return await ServerSettingsResponse.ReadAsync(settings, cancellationToken);
    }
}

internal sealed class UpdateServerSettingsRequestValidator : AbstractValidator<UpdateServerSettingsRequest>
{
    public UpdateServerSettingsRequestValidator(ServerSettingsService settings)
    {
        // The codes are the contract. Each one is what the desktop switches on
        // to put the message beside the control it is about, so they are set
        // by hand rather than left to FluentValidation's rule names.
        RuleFor(x => x.ReplayByteCap)
            .GreaterThanOrEqualTo(0L)
            .When(x => x.ReplayByteCap is not null)
            .WithErrorCode("invalid_replay_cap")
            .WithMessage("A storage cap is a number of bytes, or zero for no cap.");

        RuleFor(x => x.BackfillTarget)
            .InclusiveBetween(1, 1000)
            .When(x => x.BackfillTarget is not null)
            .WithErrorCode("invalid_backfill_target")
            .WithMessage(
                "A backfill target is between 1 and 1000 matches. Remember it is roughly one Riot "
                + "request per match, out of about a hundred every two minutes for the whole server.");

        RuleFor(x => x.TftBackfillTarget)
            .InclusiveBetween(1, 1000)
            .When(x => x.TftBackfillTarget is not null)
            .WithErrorCode("invalid_tft_backfill_target")
            .WithMessage("A TFT backfill target is between 1 and 1000 matches, on the same budget as League's.");

        RuleFor(x => x.BackgroundSyncMinutes)
            .InclusiveBetween(BackgroundSyncRules.MinIntervalMinutes, BackgroundSyncRules.MaxIntervalMinutes)
            .When(x => x.BackgroundSyncMinutes is not null)
            .WithErrorCode("invalid_background_sync_minutes")
            .WithMessage(
                $"Background sync runs every {BackgroundSyncRules.MinIntervalMinutes} to "
                + $"{BackgroundSyncRules.MaxIntervalMinutes} minutes. Each sweep is a few Riot requests for every "
                + "account on the server.");

        // Against the stored interval when the request leaves it alone, so a
        // window can never be saved that the interval already in place makes
        // meaningless — and nothing is written before this has passed.
        RuleFor(x => x)
            .MustAsync(async (request, cancellationToken) =>
            {
                var interval = request.BackgroundSyncMinutes
                    ?? await settings.GetBackgroundSyncMinutesAsync(cancellationToken);
                var skip = request.BackgroundSyncSkipMinutes
                    ?? await settings.GetBackgroundSyncSkipMinutesAsync(cancellationToken);

                return BackgroundSyncRules.Fits(interval, skip);
            })
            .When(x => x.BackgroundSyncMinutes is not null || x.BackgroundSyncSkipMinutes is not null)
            .WithErrorCode("invalid_background_sync_skip")
            .WithMessage(
                "Accounts synced recently are left alone for at least a minute and for less than the interval — "
                + "otherwise every other sweep would leave everybody alone.");
    }
}
