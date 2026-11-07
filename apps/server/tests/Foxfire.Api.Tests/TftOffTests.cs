using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Features.Import;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// A server with TFT off, which is what a host gets until they set
/// <c>Tft__Enabled</c>.
///
/// TFT needs a Riot key registered for it, and a personal key is registered
/// for one product, so a server that has League's alone has no TFT to offer.
/// Off, it behaves as if there were no TFT: /version lists League alone, which
/// is what every client reads to decide what to offer, the routes that are only
/// TFT's are the API's 404, a request naming TFT is refused like one naming a
/// game nobody has heard of, and nothing asks Riot anything about TFT.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class TftOffTests(FoxfireServerFixture server)
{
    private sealed record VersionInfo(IReadOnlyList<string> Games);

    private sealed record HealthInfo(string Status, string TftAccess);

    private sealed record ApiError(string Error);

    private static string UniquePuuid() => $"puuid-{Guid.NewGuid():N}";

    private static WebApplicationFactory<Program> Off(FakeRiot riot, WebApplicationFactory<Program> parent) =>
        riot.Host(parent, tftEnabled: false);

    private static HttpClient Desktop(WebApplicationFactory<Program> host, Session? session = null)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        return session is null ? client : FoxfireServerFixture.Authenticated(client, session);
    }

    private static async Task<Guid> AddAccountAsync(WebApplicationFactory<Program> host, Guid? ownerId = null)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = UniquePuuid(),
            GameName = $"Leaguer{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = ownerId,
            LinkedAt = ownerId is null ? null : now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);
        await db.SaveChangesAsync();
        return account.Id;
    }

    [Fact]
    public async Task The_handshake_lists_league_alone()
    {
        await using var host = Off(new FakeRiot(), server.Factory);
        using var client = host.CreateClient();

        var version = await client.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative));

        Assert.Equal(["lol"], version!.Games);
    }

    [Fact]
    public async Task A_server_with_tft_on_lists_both_league_first()
    {
        using var client = server.AnonymousClient();

        var version = await client.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative));

        Assert.Equal(["lol", "tft"], version!.Games);
    }

    [Fact]
    public async Task Nothing_asks_riot_about_tft_at_boot()
    {
        var riot = new FakeRiot();
        await using var host = Off(riot, server.Factory);
        using var client = host.CreateClient();

        // The League key's probe runs off the request path; once it has asked,
        // TFT's would have been asked beside it.
        for (var i = 0; i < 50 && riot.TokensFor("/lol/").Count == 0; i++) await Task.Delay(100);
        Assert.NotEmpty(riot.TokensFor("/lol/"));

        var health = await client.GetFromJsonAsync<HealthInfo>(new Uri("/health", UriKind.Relative));

        Assert.Equal("off", health!.TftAccess);
        Assert.Equal("healthy", health.Status);
        Assert.Empty(riot.TokensFor("/tft/"));
    }

    [Fact]
    public async Task Routes_that_are_only_tfts_are_the_apis_404()
    {
        var (admin, session) = await server.AdminAsync();
        admin.Dispose();

        await using var host = Off(new FakeRiot(), server.Factory);
        var accountId = await AddAccountAsync(host);
        using var client = Desktop(host, session);

        foreach (var path in new[]
                 {
                     $"/api/riot-accounts/{accountId}/tft/dashboard",
                     $"/api/riot-accounts/{accountId}/tft/matches",
                     $"/api/riot-accounts/{accountId}/tft/rank/history"
                 })
        {
            var response = await client.GetAsync(new Uri(path, UriKind.Relative));

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("not_found", (await response.Content.ReadFromJsonAsync<ApiError>())!.Error);
        }

        // The same account's TFT, on the suite's server with TFT on.
        using var on = FoxfireServerFixture.Authenticated(server.Client(), session);
        var dashboard = await on.GetAsync(new Uri($"/api/riot-accounts/{accountId}/tft/dashboard", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, dashboard.StatusCode);
    }

    [Fact]
    public async Task A_request_naming_tft_is_refused_as_a_game_this_server_does_not_track()
    {
        var (admin, session) = await server.AdminAsync();
        admin.Dispose();

        var riot = new FakeRiot();
        await using var host = Off(riot, server.Factory);
        var accountId = await AddAccountAsync(host, session.User.Id);
        using var client = Desktop(host, session);

        var sync = await client.PostAsync(new Uri($"/api/sync/{accountId}?game=tft", UriKind.Relative), null);
        Assert.Equal(HttpStatusCode.BadRequest, sync.StatusCode);
        Assert.Contains("unknown_game", await sync.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var state = await client.GetAsync(new Uri($"/api/sync/{accountId}?game=tft", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, state.StatusCode);

        var ended = await client.PostAsJsonAsync(
            new Uri("/api/sync/game-ended", UriKind.Relative), new { riotAccountId = accountId, game = "tft" });
        Assert.Equal(HttpStatusCode.BadRequest, ended.StatusCode);
        Assert.False(host.Services.GetRequiredService<PostGameSyncScheduler>().IsScheduled(accountId, Game.Tft));

        var seasons = await client.GetAsync(new Uri("/api/seasons?game=tft", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, seasons.StatusCode);

        // A TFT ladder the League client reported, whether or not the desktop
        // said which game it was: TFT's ladders are not ones this server tracks.
        foreach (var game in new[] { "tft", null })
        {
            var reading = await client.PostAsJsonAsync(new Uri("/api/rank-readings", UriKind.Relative), new
            {
                riotAccountId = accountId,
                queueType = "RANKED_TFT",
                tier = "GOLD",
                division = "II",
                leaguePoints = 50,
                force = false,
                game
            });

            Assert.Equal(HttpStatusCode.BadRequest, reading.StatusCode);
            Assert.Contains("unknown_queue", await reading.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        // League's, unchanged.
        var league = await client.GetAsync(new Uri("/api/seasons", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, league.StatusCode);

        Assert.Empty(riot.TokensFor("/tft/"));
    }

    [Fact]
    public async Task A_tft_sync_asked_for_inside_the_server_finds_nothing_and_asks_riot_nothing()
    {
        var riot = new FakeRiot();
        await using var host = Off(riot, server.Factory);
        var accountId = await AddAccountAsync(host);

        var result = await host.Services.GetRequiredService<SyncService>()
            .SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);

        Assert.Equal(new SyncResult(0, 0), result);
        Assert.Empty(riot.TokensFor("/tft/"));

        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        Assert.False(await db.SyncStates.AnyAsync(s => s.RiotAccountId == accountId && s.Game == Game.Tft));
    }

    [Fact]
    public async Task The_background_sweep_offers_only_league()
    {
        await using var host = Off(new FakeRiot(), server.Factory);
        var accountId = await AddAccountAsync(host);

        var due = await host.Services.GetRequiredService<BackgroundSyncs>()
            .DueAsync(DateTimeOffset.UtcNow, TimeSpan.FromMinutes(30), CancellationToken.None);

        var ours = Assert.Single(due, d => d.RiotAccountId == accountId);
        Assert.Equal(Game.Lol, ours.Game);
        Assert.DoesNotContain(due, d => d.Game == Game.Tft);
    }

    [Fact]
    public async Task An_import_leaves_a_files_tft_behind()
    {
        var (admin, session) = await server.AdminAsync();
        admin.Dispose();

        await using var host = Off(new FakeRiot(), server.Factory);
        using var client = Desktop(host, session);

        var seasons = await client.PostAsJsonAsync(
            new Uri("/api/admin/import/seasons", UriKind.Relative),
            new[] { new { label = "Set 99", startsAt = 4_102_444_800_000L, isPreseason = false, resetsRank = true, game = "tft" } });
        seasons.EnsureSuccessStatusCode();

        var tally = await seasons.Content.ReadFromJsonAsync<ImportBatchResult>();
        Assert.Equal(0, tally!.Accepted);
        Assert.Equal(1, tally.Skipped);

        var matches = await client.PostAsJsonAsync(
            new Uri("/api/admin/import/tft-matches", UriKind.Relative), Array.Empty<object>());
        Assert.Equal(HttpStatusCode.NotFound, matches.StatusCode);
    }
}
