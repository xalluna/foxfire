using Foxfire.Api.Auth;
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
///
/// Open to outsiders only on an open server. A share link opens one profile,
/// and a finder is the way to every other one.
/// </summary>
public static class SearchEndpoints
{
    public static void MapSearchEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGet("/search", (
                    string? q,
                    bool? mine,
                    bool? claimed,
                    int? limit,
                    int? offset,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(
                    new SearchPlayersRequest(q, mine ?? false, claimed ?? false, limit, offset),
                    cancellationToken))
            .WithTags("Search")
            .AllowOutsiders()
            .RequireRateLimiting(RateLimits.Search);
}
