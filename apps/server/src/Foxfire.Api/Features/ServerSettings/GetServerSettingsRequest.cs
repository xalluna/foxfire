using Foxfire.Api.Common;
using Foxfire.Api.Services;

namespace Foxfire.Api.Features.ServerSettings;

/// <summary>The current state of the switches an admin can throw.</summary>
/// <remarks>
/// Declared here rather than beside the update, because both answer with it and
/// this is the request whose whole job is producing one.
/// </remarks>
public sealed record ServerSettingsResponse(
    bool PublicSignup,
    int BackfillTarget,
    long ReplayByteCap)
{
    /// <summary>
    /// Reads all three, so the two handlers that answer with this cannot drift
    /// apart on what "all three" means.
    /// </summary>
    internal static async Task<ServerSettingsResponse> ReadAsync(
        ServerSettingsService settings,
        CancellationToken cancellationToken) =>
        new(await settings.IsPublicSignupEnabledAsync(cancellationToken),
            await settings.GetBackfillTargetAsync(cancellationToken),
            await settings.GetReplayByteCapAsync(cancellationToken));
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
