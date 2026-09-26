using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Features.Insights;
using Foxfire.Api.Sync;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The insights page, from the server's side: who may read it, what it counts,
/// and how its history is written down and read back.
///
/// Most of these run a host of their own, so that what it counted is only what
/// the test did — every host listens only to its own meters. The fixture has
/// persistence off, because dozens of hosts share its database; the tests of
/// the history drive the store themselves, and one host switches it back on to
/// read what they wrote.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public sealed class InsightsTests(FoxfireServerFixture server)
{
    private static readonly string[] Sections = ["overview", "requests", "riot", "sync", "runtime", "logs"];

    private static Uri Route(string path) => new(path, UriKind.Relative);

    /// <summary>A client on <paramref name="host"/> signed in as the admin, whose session the fixture's host issued.</summary>
    private async Task<HttpClient> AdminOnAsync(WebApplicationFactory<Program> host)
    {
        var (fixtureClient, session) = await server.AdminAsync();
        fixtureClient.Dispose();

        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        return FoxfireServerFixture.Authenticated(client, session);
    }

    /// <summary>
    /// Asks until the answer passes. ASP.NET records a request's duration as the
    /// request is torn down, which in the test server can be just after the
    /// client has its response.
    /// </summary>
    private static async Task<T> EventuallyAsync<T>(Func<Task<T>> read, Func<T, bool> done)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (true)
        {
            var value = await read();
            if (done(value) || DateTimeOffset.UtcNow > deadline) return value;
            await Task.Delay(100);
        }
    }

    [Fact]
    public async Task Only_an_admin_can_read_insights()
    {
        using var anonymous = server.Client();

        using var memberClient = server.Client();
        var member = await server.RegisterAsync(
            memberClient, $"Nosy{Guid.NewGuid():N}"[..12], $"nosy-{Guid.NewGuid():N}@example.com");
        FoxfireServerFixture.Authenticated(memberClient, member);

        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        foreach (var section in Sections)
        {
            var route = Route($"/api/admin/insights/{section}");

            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(route)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await memberClient.GetAsync(route)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(route)).StatusCode);
        }
    }

    [Fact]
    public async Task Every_window_answers_with_a_point_for_every_step_and_a_made_up_one_is_refused()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        foreach (var window in InsightWindows.All)
        {
            var overview = await admin.GetFromJsonAsync<InsightsOverviewResponse>(
                Route($"/api/admin/insights/overview?window={window.Key}"));

            Assert.NotNull(overview);
            Assert.Equal(window.Key, overview.Frame.Window);
            Assert.Equal(window.Points, overview.Frame.Points);
            Assert.Equal(window.Points, overview.Frame.Up.Count);
            Assert.All(overview.Series, s => Assert.Equal(window.Points, s.Values.Count));

            // The point still filling is always there: the process is up for it.
            Assert.True(overview.Frame.Up[^1]);
        }

        var refused = await admin.GetAsync(Route("/api/admin/insights/requests?window=3y"));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal("invalid_window", (await refused.Content.ReadFromJsonAsync<ApiError>())!.Error);
    }

    [Fact]
    public async Task A_request_is_counted_under_its_route_and_client_and_the_hub_and_the_page_itself_are_not()
    {
        await using var host = server.Factory.WithWebHostBuilder(_ => { });

        using var web = host.CreateClient();
        web.DefaultRequestHeaders.Add("X-Foxfire-Client", "web");
        web.DefaultRequestHeaders.Add(
            "X-Foxfire-Api-Version",
            DesktopCompatibility.WebApiVersions[^1].ToString(System.Globalization.CultureInfo.InvariantCulture));

        for (var i = 0; i < 3; i++) await web.GetAsync(Route("/api/version"));

        using var anonymous = host.CreateClient();
        await anonymous.GetAsync(Route("/api/hub"));

        using var admin = await AdminOnAsync(host);

        var requests = await EventuallyAsync(
            async () => (await admin.GetFromJsonAsync<InsightsRequestsResponse>(
                Route("/api/admin/insights/requests?window=15m")))!,
            r => r.Clients.Any(c => c.Kind == "web" && c.Count >= 3));

        var version = Assert.Single(requests.Routes, r => r.Route == "/api/version");
        Assert.Equal("GET", version.Method);
        Assert.True(version.Count >= 3);
        Assert.Contains(requests.Clients, c => c.Kind == "web" && c.Count >= 3);

        Assert.DoesNotContain(requests.Routes, r => r.Route.Contains("hub", StringComparison.Ordinal));
        Assert.DoesNotContain(requests.Routes, r => r.Route.Contains("insights", StringComparison.Ordinal));
        Assert.True(requests.Total >= 3);
        Assert.Contains(requests.ByStatus, s => s.Key == "2xx" && s.Values[^1] >= 3);
    }

    [Fact]
    public async Task A_sync_is_counted_with_the_Riot_calls_it_made()
    {
        var puuid = $"puuid-{Guid.NewGuid():N}";
        var matchId = $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";
        var played = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeMilliseconds();

        var riot = new FakeRiot()
            .WithMatchIds(puuid, matchId)
            .WithMatch(matchId, MatchPayloads.TenPlayerGame(matchId, played, 420, [puuid]));

        await using var host = riot.Host(server.Factory);

        Guid accountId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var now = DateTimeOffset.UtcNow;
            var account = new RiotAccount
            {
                Id = Guid.CreateVersion7(now),
                Puuid = puuid,
                GameName = $"Insight{Guid.NewGuid().ToString("N")[..8]}",
                TagLine = "NA1",
                Platform = "na1",
                RegionalRoute = "americas",
                CreatedAt = now,
                UpdatedAt = now
            };

            db.RiotAccounts.Add(account);
            await db.SaveChangesAsync();
            accountId = account.Id;
        }

        await host.Services.GetRequiredService<SyncService>().SyncAsync(accountId, SyncTrigger.Manual);

        using var admin = await AdminOnAsync(host);

        var sync = (await admin.GetFromJsonAsync<InsightsSyncResponse>(Route("/api/admin/insights/sync?window=15m")))!;

        var run = Assert.Single(sync.Recent, r => r.AccountId == accountId);
        Assert.Equal("ok", run.Outcome);
        Assert.Equal("backfill", run.Kind);
        Assert.Equal("manual", run.Trigger);
        Assert.Equal(1, run.Stored);
        Assert.True(sync.Totals.Runs >= 1);
        Assert.True(sync.Totals.Stored >= 1);

        var calls = (await admin.GetFromJsonAsync<InsightsRiotResponse>(Route("/api/admin/insights/riot?window=15m")))!;

        var ids = Assert.Single(calls.Endpoints, e => e.Endpoint == "/lol/match/v5/matches/by-puuid/{puuid}/ids");
        Assert.True(ids.Calls >= 1);
        Assert.Contains(calls.Endpoints, e => e.Endpoint == "/lol/match/v5/matches/{matchId}");
        Assert.Contains(calls.Priorities, p => p.Priority == "backfill" && p.Requests >= 1);
        Assert.Equal(3, calls.Now.Depths.Count);
    }

    [Fact]
    public async Task History_is_read_from_hours_minutes_and_memory_without_counting_anything_twice()
    {
        var route = $"/test/{Guid.NewGuid():N}";
        var dimensions = InsightMetrics.Dimensions(route, "GET", "2xx", "desktop");
        var now = DateTimeOffset.UtcNow;
        var threeHoursAgo = InsightWindow.Floor(now.AddHours(-3), TimeSpan.FromHours(1));
        var fiveMinutesAgo = InsightWindow.Floor(now.AddMinutes(-5), TimeSpan.FromMinutes(1));

        await using (var scope = server.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var instance = Guid.NewGuid();

            // An hour already folded, alongside the minutes it was folded from...
            await TelemetryStore.FlushAsync(db, instance, threeHoursAgo.AddMinutes(10), Requests(dimensions, 5), default);
            Assert.True(await TelemetryStore.FoldHourAsync(db, threeHoursAgo, default));

            // ...and a minute that has not been.
            await TelemetryStore.FlushAsync(db, instance, fiveMinutesAgo, Requests(dimensions, 2), default);
        }

        await using var host = server.Factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?> { ["Telemetry:Persist"] = "true" })));

        using var admin = await AdminOnAsync(host);

        var hour = (await admin.GetFromJsonAsync<InsightsRequestsResponse>(Route("/api/admin/insights/requests?window=1h")))!;
        var week = (await admin.GetFromJsonAsync<InsightsRequestsResponse>(Route("/api/admin/insights/requests?window=7d")))!;

        Assert.Equal(2, Assert.Single(hour.Routes, r => r.Route == route).Count);
        Assert.Equal(7, Assert.Single(week.Routes, r => r.Route == route).Count);
    }

    [Fact]
    public async Task Minutes_two_processes_wrote_add_up()
    {
        var metric = $"test.{Guid.NewGuid():N}";
        var minute = new DateTimeOffset(2001, 1, 1, 0, 5, 0, TimeSpan.Zero);

        await using var scope = server.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        // The process that stopped part-way through the minute, and the one that started.
        await TelemetryStore.FlushAsync(db, Guid.NewGuid(), minute, Counted(metric, 3), default);
        await TelemetryStore.FlushAsync(db, Guid.NewGuid(), minute, Counted(metric, 4), default);

        var rows = await TelemetryStore.ReadAsync(
            db, TelemetryResolution.Minute, [metric], minute, minute.AddMinutes(1), default);

        Assert.Equal(2, rows.Count);
        Assert.Equal(7, TelemetryStore.Merge(rows)[new SeriesKey(metric, "")].Count);
    }

    [Fact]
    public async Task Folding_an_hour_twice_writes_it_once()
    {
        var metric = $"test.{Guid.NewGuid():N}";
        var hour = new DateTimeOffset(2001, 2, 1, 3, 0, 0, TimeSpan.Zero);

        await using var scope = server.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        await TelemetryStore.FlushAsync(db, Guid.NewGuid(), hour.AddMinutes(1), Counted(metric, 2), default);
        await TelemetryStore.FlushAsync(db, Guid.NewGuid(), hour.AddMinutes(59), Counted(metric, 5), default);

        Assert.Equal([hour], await TelemetryStore.UnfoldedHoursAsync(db, hour, hour.AddHours(1), default));

        Assert.True(await TelemetryStore.FoldHourAsync(db, hour, default));
        Assert.False(await TelemetryStore.FoldHourAsync(db, hour, default));

        var hours = await TelemetryStore.ReadAsync(db, TelemetryResolution.Hour, [metric], hour, hour.AddHours(1), default);
        Assert.Equal(7, Assert.Single(hours).Count);
        Assert.Empty(await TelemetryStore.UnfoldedHoursAsync(db, hour, hour.AddHours(1), default));
    }

    [Fact]
    public async Task Pruning_keeps_what_is_inside_each_limit()
    {
        var metric = $"test.{Guid.NewGuid():N}";
        var old = new DateTimeOffset(2001, 3, 1, 0, 0, 0, TimeSpan.Zero);
        var recent = old.AddDays(2);

        await using var scope = server.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        await TelemetryStore.FlushAsync(db, Guid.NewGuid(), old, Counted(metric, 1), default);
        await TelemetryStore.FlushAsync(db, Guid.NewGuid(), recent, Counted(metric, 1), default);
        await TelemetryStore.FoldHourAsync(db, old, default);
        await TelemetryStore.FoldHourAsync(db, recent, default);

        // Minutes older than a day go; hours are kept for good.
        await TelemetryStore.PruneAsync(db, old.AddDays(1), hoursBefore: null, default);

        var mine = db.TelemetryRollups.Where(r => r.Metric == metric);
        Assert.Equal([recent], await mine.Where(r => r.Resolution == TelemetryResolution.Minute).Select(r => r.BucketStart).ToListAsync());
        Assert.Equal(2, await mine.CountAsync(r => r.Resolution == TelemetryResolution.Hour));

        // Now with a limit on hours too.
        await TelemetryStore.PruneAsync(db, old.AddDays(1), hoursBefore: old.AddDays(1), default);
        Assert.Equal([recent], await mine.Where(r => r.Resolution == TelemetryResolution.Hour).Select(r => r.BucketStart).ToListAsync());
    }

    private static Dictionary<SeriesKey, InsightAggregate> Requests(string dimensions, int count)
    {
        var aggregate = InsightAggregate.Duration();
        for (var i = 0; i < count; i++) aggregate.Record(20);
        return new() { [new SeriesKey(InsightMetrics.HttpRequests, dimensions)] = aggregate };
    }

    private static Dictionary<SeriesKey, InsightAggregate> Counted(string metric, int count)
    {
        var aggregate = InsightAggregate.Plain();
        for (var i = 0; i < count; i++) aggregate.Record(1);
        return new() { [new SeriesKey(metric, "")] = aggregate };
    }
}
