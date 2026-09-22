using Foxfire.Api.Common;
using Foxfire.Api.Features.Search;
using Foxfire.Api.Startup;
using MediatR;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Looking somebody up who is not on this server.
///
/// Rate limited per address: every search is a live call to Riot on the one key
/// the whole community shares.
/// </summary>
public static class SearchEndpoints
{
    public static void MapSearchEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGet("/search", (
                    string gameName,
                    string tagLine,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new SearchSummonerRequest(gameName, tagLine), cancellationToken))
            .WithTags("Search")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimits.Search);
}
