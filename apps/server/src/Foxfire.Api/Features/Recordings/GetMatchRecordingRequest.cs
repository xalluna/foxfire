using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// One account's recording of one game, with its markers.
///
/// Readable by every member, like everything else here. The pair is the whole
/// question: the same game asked for under a different account is a different
/// recording, or none, and never falls back to somebody else's.
/// </summary>
public sealed record GetMatchRecordingRequest(Guid RiotAccountId, string MatchId)
    : IDomainRequest<MatchRecordingResponse>;

internal sealed class GetMatchRecordingRequestHandler(FoxfireDbContext db)
    : IDomainRequestHandler<GetMatchRecordingRequest, MatchRecordingResponse>
{
    public async Task<Response<MatchRecordingResponse>> Handle(
        GetMatchRecordingRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var found = await db.MatchRecordings
            .AsNoTracking()
            .Where(r => r.MatchId == request.MatchId && r.RiotAccountId == request.RiotAccountId)
            .Select(r => new { Row = r, AttachedBy = r.AttachedBy != null ? r.AttachedBy.UserName : null })
            .FirstOrDefaultAsync(cancellationToken);

        return found is null
            ? Response<MatchRecordingResponse>.NotFound()
            : Recordings.ToResponse(found.Row, found.AttachedBy);
    }
}
