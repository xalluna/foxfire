using System.Globalization;
using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Sync;

/// <summary>
/// Asks the server to fetch what it does not have for one account.
///
/// Answers as soon as the run is started rather than when it finishes, because
/// a backfill is minutes of Riot requests. Progress arrives over the hub.
///
/// Open to any member, which is a deliberate exception to the rule that writes
/// are the owner's. An account an admin added belongs to nobody, nothing on
/// this server syncs on a timer, and the post-game ladder is armed by a desktop
/// watching a League client that account has none of — so owner-only would mean
/// its history froze on the day it was added. What stops that from being an
/// open tap on the community's Riot key is <see cref="SyncCooldown"/>.
/// </summary>
public sealed record StartSyncRequest(Guid RiotAccountId) : IEmptyDomainRequest;

internal sealed class StartSyncRequestHandler(FoxfireDbContext db, SyncService sync, TimeProvider time)
    : IDomainRequestHandler<StartSyncRequest>
{
    public async Task<Response> Handle(StartSyncRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var known = await db.RiotAccounts
            .AnyAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        // A failure with a code rather than a bare Response.NotFound(): the sync
        // route reads Errors to decide between its own 202 and the handler's
        // answer, and a bodyless 404 carries none. It is also no longer folded
        // into not_your_account — with ownership out of the way there is nothing
        // to hide behind one answer for both.
        if (!known)
        {
            return Response.Failure(
                new Error("no_such_account", "This server does not track that League account."),
                HttpStatusCode.NotFound);
        }

        var state = await db.SyncStates
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.RiotAccountId == request.RiotAccountId, cancellationToken);

        // Clients hold the button until the same moment, so this is only met by
        // one whose clock disagrees with ours, or that pressed a moment before
        // somebody else's sync finished.
        var now = time.GetUtcNow();

        if (SyncCooldown.Until(state) is { } until && now < until)
        {
            var seconds = (int)Math.Ceiling((until - now).TotalSeconds);

            return Response.Failure(
                new Error(
                    "sync_too_soon",
                    $"This account was synced less than two minutes ago. Try again in {seconds.ToString(CultureInfo.InvariantCulture)} seconds."),
                HttpStatusCode.TooManyRequests);
        }

        // Deliberately not awaited. The result is delivered as progress events,
        // and a failed run has already reported itself as one.
        _ = sync.SyncAsync(request.RiotAccountId, SyncTrigger.Manual, CancellationToken.None);

        return Response.Success(HttpStatusCode.Accepted);
    }
}

/// <summary>
/// The end-of-game signal, from the desktop that saw it.
///
/// Still the owner's alone, unlike starting a sync. This is not a request for
/// data but a claim to have watched a League client finish a game, and the only
/// machine in a position to make it is the one that account is signed in on.
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
        return Response.Success(HttpStatusCode.Accepted);
    }
}
