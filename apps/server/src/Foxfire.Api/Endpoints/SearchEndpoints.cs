using Foxfire.Api.Common;
using Foxfire.Api.Features.Search;
using Foxfire.Api.Startup;
using MediatR;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Finding somebody this server tracks.
///
/// Still rate limited per address, though it no longer calls Riot: the query is
/// an unindexed substring scan over every tracked account, and the limit that
/// used to protect the API key now protects the database.
/// </summary>
public static class SearchEndpoints
{
    public static void MapSearchEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGet("/search", (
                    string? q,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new SearchPlayersRequest(q), cancellationToken))
            .WithTags("Search")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimits.Search);
}
