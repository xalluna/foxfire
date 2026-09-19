using Foxfire.Api.Common;
using Foxfire.Api.Sync;

namespace Foxfire.Api.Features.Sync;

/// <summary>
/// Asks the server to fetch what it does not have for one account.
///
/// Answers as soon as the run is started rather than when it finishes, because
/// a backfill is minutes of Riot requests. Progress arrives over the hub.
/// </summary>
public sealed record StartSyncRequest(Guid RiotAccountId) : IEmptyDomainRequest;

internal sealed class StartSyncRequestHandler(AccountOwnership ownership, SyncService sync)
    : IDomainRequestHandler<StartSyncRequest>
{
    public async Task<Response> Handle(StartSyncRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await ownership.MineAsync(request.RiotAccountId, cancellationToken);
        if (account is null) return Response.Failure(AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);

        // Deliberately not awaited. The result is delivered as progress events,
        // and a failed run has already reported itself as one.
        _ = sync.SyncAsync(request.RiotAccountId, SyncTrigger.Manual, CancellationToken.None);

        return Response.Success(System.Net.HttpStatusCode.Accepted);
    }
}

/// <summary>
/// The end-of-game signal, from the desktop that saw it.
///
/// Accepted even when a ladder is already running for the account: the later
/// game's schedule replaces the earlier one, and a delta sync fetches
/// everything new, so the first game is found by the second game's attempts
/// anyway.
/// </summary>
public sealed record GameEndedRequest(Guid RiotAccountId) : IEmptyDomainRequest;

internal sealed class GameEndedRequestHandler(AccountOwnership ownership, PostGameSyncScheduler scheduler)
    : IDomainRequestHandler<GameEndedRequest>
{
    public async Task<Response> Handle(GameEndedRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await ownership.MineAsync(request.RiotAccountId, cancellationToken);
        if (account is null) return Response.Failure(AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);

        scheduler.Schedule(request.RiotAccountId);
        return Response.Success(System.Net.HttpStatusCode.Accepted);
    }
}
