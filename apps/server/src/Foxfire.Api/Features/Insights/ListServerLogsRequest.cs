using Foxfire.Api.Common;
using Foxfire.Api.Telemetry;

namespace Foxfire.Api.Features.Insights;

/// <summary>
/// The server's recent log lines, newest first, a page at a time.
///
/// Paged like every list that grows, with one addition: <paramref name="Before"/>
/// pins "Show more" to where the first page started. A busy server writes a line
/// per request, so without it the second page would repeat whatever the first
/// page's last lines had been pushed down to.
/// </summary>
/// <param name="Level">information (every line), warning, or error.</param>
/// <param name="Before">Only lines older than this sequence number.</param>
public sealed record ListServerLogsRequest(string? Level, int? Limit, int? Offset, long? Before)
    : IDomainRequest<Page<ServerLogEntry>>;

internal sealed class ListServerLogsRequestHandler(RecentLogs logs)
    : IDomainRequestHandler<ListServerLogsRequest, Page<ServerLogEntry>>
{
    public Task<Response<Page<ServerLogEntry>>> Handle(ListServerLogsRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var page = logs.Read(request.Level, PageRequest.Of(request.Limit, request.Offset), request.Before);
        return Task.FromResult<Response<Page<ServerLogEntry>>>(page);
    }
}
