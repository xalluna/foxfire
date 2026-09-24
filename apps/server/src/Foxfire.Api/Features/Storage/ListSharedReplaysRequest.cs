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
/// The library, biggest first, a page at a time.
///
/// Biggest rather than newest, because the reason to open this list is that
/// something needs to go. Paged rather than cut off: a long-running community
/// has thousands, and while nobody scrolls far looking for space, the replay
/// they came to delete should not be one the list simply cannot reach.
/// </summary>
public sealed record ListSharedReplaysRequest(int? Limit = null, int? Offset = null)
    : IDomainRequest<Page<AdminReplayResponse>>;

internal sealed class ListSharedReplaysRequestHandler(FoxfireDbContext db)
    : IDomainRequestHandler<ListSharedReplaysRequest, Page<AdminReplayResponse>>
{
    public async Task<Response<Page<AdminReplayResponse>>> Handle(
        ListSharedReplaysRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var replays = await db.SharedReplays
            .AsNoTracking()
            .Include(r => r.UploadedBy)
            .Where(r => r.UploadedAt != null)
            .OrderByDescending(r => r.FileBytes)
            .ThenBy(r => r.MatchId)
            .ToPageAsync(PageRequest.Of(request.Limit, request.Offset), cancellationToken);

        return Response<Page<AdminReplayResponse>>.Success(
            replays.Map(r => new AdminReplayResponse(
                r.MatchId, r.Patch, r.FileBytes, r.UploadedBy?.UserName, r.UploadedAt)));
    }
}
