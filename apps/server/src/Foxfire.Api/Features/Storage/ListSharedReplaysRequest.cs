using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Storage;

/// <summary>What a shared replay looks like to whoever is deciding to delete it.</summary>
public sealed record AdminReplayResponse(
    string MatchId,
    string? Patch,
    long? FileBytes,
    string? UploadedBy,
    DateTimeOffset? UploadedAt);

/// <summary>
/// The library, biggest first.
///
/// Biggest rather than newest, because the reason to open this list is that
/// something needs to go. Capped, since a long-running community has thousands
/// and nobody scrolls past the first screen looking for space.
/// </summary>
public sealed record ListSharedReplaysRequest(int Limit = 50)
    : IDomainRequest<IReadOnlyList<AdminReplayResponse>>;

internal sealed class ListSharedReplaysRequestHandler(FoxfireDbContext db)
    : IDomainRequestHandler<ListSharedReplaysRequest, IReadOnlyList<AdminReplayResponse>>
{
    public async Task<Response<IReadOnlyList<AdminReplayResponse>>> Handle(
        ListSharedReplaysRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var replays = await db.SharedReplays
            .AsNoTracking()
            .Include(r => r.UploadedBy)
            .Where(r => r.UploadedAt != null)
            .OrderByDescending(r => r.FileBytes)
            // Clamped rather than refused, which is what this route has
            // always done. Turning it into a validation failure would be a
            // change to the contract for no gain nobody asked for.
            .Take(Math.Clamp(request.Limit, 1, 200))
            .ToListAsync(cancellationToken);

        return Response<IReadOnlyList<AdminReplayResponse>>.Success(
        [
            .. replays.Select(r => new AdminReplayResponse(
                r.MatchId, r.Patch, r.FileBytes, r.UploadedBy?.UserName, r.UploadedAt))
        ]);
    }
}
