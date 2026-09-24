using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Sync;

/// <summary>How far through fetching an account's history the server has got.</summary>
/// <param name="AccountId">
/// Named as the desktop names it. Spelled riotAccountId once, which the desktop
/// read as undefined and then keyed a progress bar on.
/// </param>
/// <param name="CooldownUntil">
/// When this account can next be synced — see <see cref="SyncCooldown"/>. What
/// "Sync now" waits for, rather than the client knowing the rule itself.
/// </param>
public sealed record SyncStateResponse(
    Guid AccountId,
    string? MostRecentMatchId,
    bool BackfillComplete,
    int BackfillTarget,
    DateTimeOffset? LastFullSyncAt,
    DateTimeOffset? LastDeltaSyncAt,
    bool IsSyncing,
    DateTimeOffset? CooldownUntil)
{
    public static SyncStateResponse Describe(SyncState state, bool isSyncing)
    {
        ArgumentNullException.ThrowIfNull(state);

        return new SyncStateResponse(
            state.RiotAccountId,
            state.MostRecentMatchId,
            state.BackfillComplete,
            state.BackfillTarget,
            state.LastFullSyncAt,
            state.LastDeltaSyncAt,
            isSyncing,
            SyncCooldown.Until(state));
    }
}

/// <summary>
/// Readable by any member, like everything else here: the progress bar on
/// somebody else's account is not a secret, and hiding it would make a shared
/// history look broken while it filled in.
/// </summary>
public sealed record GetSyncStateRequest(Guid RiotAccountId) : IDomainRequest<SyncStateResponse>;

internal sealed class GetSyncStateRequestHandler(FoxfireDbContext db, SyncService sync)
    : IDomainRequestHandler<GetSyncStateRequest, SyncStateResponse>
{
    public async Task<Response<SyncStateResponse>> Handle(
        GetSyncStateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var id = request.RiotAccountId;

        var state = await db.SyncStates
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.RiotAccountId == id, cancellationToken);

        if (state is null)
        {
            var known = await db.RiotAccounts.AnyAsync(a => a.Id == id, cancellationToken);
            if (!known) return Response<SyncStateResponse>.NotFound();

            // Linked but never synced. A null row and a zeroed one say the same
            // thing to the desktop, and the zeroed one saves it a special case.
            return new SyncStateResponse(id, null, false, 0, null, null, sync.IsSyncing(id), null);
        }

        return SyncStateResponse.Describe(state, sync.IsSyncing(id));
    }
}
