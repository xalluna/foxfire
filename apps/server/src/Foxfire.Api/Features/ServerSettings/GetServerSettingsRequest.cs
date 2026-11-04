using Foxfire.Api.Common;
using Foxfire.Api.Services;

namespace Foxfire.Api.Features.ServerSettings;

/// <summary>The current state of the switches an admin can throw.</summary>
/// <remarks>
/// Declared here rather than beside the update, because both answer with it and
/// this is the request whose whole job is producing one.
/// </remarks>
/// <param name="PublicAccess">Whether anybody can read this server without signing in.</param>
/// <param name="BackgroundSync">Whether the server syncs every tracked account by itself.</param>
/// <param name="BackgroundSyncMinutes">Between the starts of two background sweeps.</param>
/// <param name="BackgroundSyncSkipMinutes">A sweep leaves alone an account synced this recently.</param>
/// <param name="PublicSignupChosen">
/// Whether somebody has decided sign-up either way. False only on a server from
/// before new servers started invite-only, open by default and never told so —
/// which is what the admin pages ask its owner to settle.
/// </param>
public sealed record ServerSettingsResponse(
    bool PublicSignup,
    int BackfillTarget,
    long ReplayByteCap,
    int TftBackfillTarget,
    bool PublicAccess,
    bool BackgroundSync,
    int BackgroundSyncMinutes,
    int BackgroundSyncSkipMinutes,
    bool PublicSignupChosen)
{
    /// <summary>
    /// Reads every switch, so the two handlers that answer with this cannot
    /// drift apart on what "every" means.
    /// </summary>
    internal static async Task<ServerSettingsResponse> ReadAsync(
        ServerSettingsService settings,
        CancellationToken cancellationToken) =>
        new(await settings.IsPublicSignupEnabledAsync(cancellationToken),
            await settings.GetBackfillTargetAsync(cancellationToken),
            await settings.GetReplayByteCapAsync(cancellationToken),
            await settings.GetTftBackfillTargetAsync(cancellationToken),
            await settings.IsPublicAccessEnabledAsync(cancellationToken),
            await settings.IsBackgroundSyncEnabledAsync(cancellationToken),
            await settings.GetBackgroundSyncMinutesAsync(cancellationToken),
            await settings.GetBackgroundSyncSkipMinutesAsync(cancellationToken),
            await settings.IsPublicSignupChosenAsync(cancellationToken));
}

/// <summary>What this server currently allows.</summary>
public sealed record GetServerSettingsRequest : IDomainRequest<ServerSettingsResponse>;

internal sealed class GetServerSettingsRequestHandler(ServerSettingsService settings)
    : IDomainRequestHandler<GetServerSettingsRequest, ServerSettingsResponse>
{
    public async Task<Response<ServerSettingsResponse>> Handle(
        GetServerSettingsRequest request,
        CancellationToken cancellationToken) =>
        await ServerSettingsResponse.ReadAsync(settings, cancellationToken);
}
