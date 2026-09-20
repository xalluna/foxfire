using Foxfire.Api.Common;
using Foxfire.Api.Features.Search;
using MediatR;

namespace Foxfire.Api.Endpoints;

/// <summary>Looking somebody up who is not on this server.</summary>
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
            .RequireAuthorization();
}
