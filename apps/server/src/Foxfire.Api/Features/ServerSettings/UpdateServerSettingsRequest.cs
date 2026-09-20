using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Services;

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
public sealed record UpdateServerSettingsRequest(
    bool? PublicSignup,
    int? BackfillTarget,
    long? ReplayByteCap) : IValidatedRequest<ServerSettingsResponse>;

internal sealed class UpdateServerSettingsRequestHandler(
    ServerSettingsService settings,
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

        if (request.BackfillTarget is { } target)
        {
            await settings.SetBackfillTargetAsync(target, cancellationToken);
            logger.LogInformation("Backfill target is now {Target} matches", target);
        }

        if (request.ReplayByteCap is { } cap)
        {
            await settings.SetReplayByteCapAsync(cap, cancellationToken);
        }

        return await ServerSettingsResponse.ReadAsync(settings, cancellationToken);
    }
}

internal sealed class UpdateServerSettingsRequestValidator : AbstractValidator<UpdateServerSettingsRequest>
{
    public UpdateServerSettingsRequestValidator()
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
    }
}
