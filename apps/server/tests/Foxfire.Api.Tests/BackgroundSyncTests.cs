using System.Net.Http.Json;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The timed sweep: its switches, and whom it leaves alone.
///
/// The sweep itself is never let loose here. Every test shares one database,
/// and a sweep is every account in it — so the fixture keeps the hosted loop
/// off (Sync__Background=false), and these drive the parts a sweep is made of
/// against their own accounts: which histories are due, in what order, and what
/// one of them comes to.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class BackgroundSyncTests(FoxfireServerFixture server)
{
    private static readonly Uri Settings = new("/api/admin/settings/", UriKind.Relative);

    private static readonly TimeSpan Skip = TimeSpan.FromMinutes(BackgroundSyncRules.SkipMinutesDefault);

    private static string UniquePuuid() => $"puuid-{Guid.NewGuid():N}";

    /// <summary>An account, and — when it has been synced — its League sync state.</summary>
    private static async Task<Guid> AddAccountAsync(
        WebApplicationFactory<Program> host,
        string puuid,
        DateTimeOffset? lastSynced)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = puuid,
            GameName = $"Sweep{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);

        if (lastSynced is { } at)
        {
            db.SyncStates.Add(new SyncState
            {
                RiotAccountId = account.Id,
                Game = Game.Lol,
                BackfillComplete = true,
                BackfillTarget = 200,
                LastFullSyncAt = at,
                LastDeltaSyncAt = at
            });
        }

        await db.SaveChangesAsync();
        return account.Id;
    }

    private static async Task<DateTimeOffset?> LastDeltaAsync(WebApplicationFactory<Program> host, Guid accountId)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        return await db.SyncStates.AsNoTracking()
            .Where(s => s.RiotAccountId == accountId && s.Game == Game.Lol)
            .Select(s => s.LastDeltaSyncAt)
            .FirstAsync();
    }

    [Fact]
    public async Task It_is_off_every_half_hour_and_leaves_a_quarter_hour_alone_until_somebody_says_otherwise()
    {
        using var admin = (await server.AdminAsync()).Client;

        var settings = await admin.GetFromJsonAsync<ServerSettings>(Settings);

        Assert.False(settings?.BackgroundSync);
        Assert.Equal(30, settings?.BackgroundSyncMinutes);
        Assert.Equal(15, settings?.BackgroundSyncSkipMinutes);
    }

    [Fact]
    public async Task Turning_it_on_and_changing_the_timings_sticks()
    {
        using var admin = (await server.AdminAsync()).Client;

        try
        {
            var response = await admin.PatchAsJsonAsync(
                Settings,
                new { backgroundSync = true, backgroundSyncMinutes = 20, backgroundSyncSkipMinutes = 10 });

            var settings = await response.Content.ReadFromJsonAsync<ServerSettings>();
            Assert.True(settings?.BackgroundSync);
            Assert.Equal(20, settings?.BackgroundSyncMinutes);
            Assert.Equal(10, settings?.BackgroundSyncSkipMinutes);
        }
        finally
        {
            await admin.PatchAsJsonAsync(
                Settings,
                new { backgroundSync = false, backgroundSyncMinutes = 30, backgroundSyncSkipMinutes = 15 });
        }
    }

    [Theory]
    [InlineData(5)]
    [InlineData(0)]
    [InlineData(2000)]
    public async Task An_impossible_interval_is_refused(int minutes)
    {
        using var admin = (await server.AdminAsync()).Client;

        var response = await admin.PatchAsJsonAsync(Settings, new { backgroundSyncMinutes = minutes });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("invalid_background_sync_minutes", error?.Error);
    }

    [Fact]
    public async Task A_window_as_long_as_the_stored_interval_is_refused_and_changes_nothing()
    {
        // The request leaves the interval alone, so the window is checked
        // against the thirty minutes already stored — and the switch it came
        // with is not written either.
        using var admin = (await server.AdminAsync()).Client;

        var response = await admin.PatchAsJsonAsync(
            Settings,
            new { backgroundSync = true, backgroundSyncSkipMinutes = 30 });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("invalid_background_sync_skip", error?.Error);

        var after = await admin.GetFromJsonAsync<ServerSettings>(Settings);
        Assert.False(after?.BackgroundSync);
        Assert.Equal(15, after?.BackgroundSyncSkipMinutes);
    }

    [Fact]
    public async Task A_window_that_fits_the_interval_it_comes_with_is_accepted()
    {
        using var admin = (await server.AdminAsync()).Client;

        try
        {
            var response = await admin.PatchAsJsonAsync(
                Settings,
                new { backgroundSyncMinutes = 60, backgroundSyncSkipMinutes = 45 });

            var settings = await response.Content.ReadFromJsonAsync<ServerSettings>();
            Assert.Equal(60, settings?.BackgroundSyncMinutes);
            Assert.Equal(45, settings?.BackgroundSyncSkipMinutes);
        }
        finally
        {
            await admin.PatchAsJsonAsync(
                Settings,
                new { backgroundSyncSkipMinutes = 15, backgroundSyncMinutes = 30 });
        }
    }

    [Fact]
    public async Task A_server_that_has_not_turned_it_on_never_sweeps()
    {
        var sweeps = server.Factory.Services.GetRequiredService<BackgroundSyncs>();

        Assert.False(await sweeps.RunIfDueAsync(CancellationToken.None));
    }

    [Fact]
    public async Task The_stalest_are_due_first_and_the_recently_synced_are_not_due_at_all()
    {
        var host = server.Factory;
        var now = DateTimeOffset.UtcNow;

        var older = await AddAccountAsync(host, UniquePuuid(), now.AddMinutes(-40));
        var newer = await AddAccountAsync(host, UniquePuuid(), now.AddMinutes(-20));
        var never = await AddAccountAsync(host, UniquePuuid(), null);
        var fresh = await AddAccountAsync(host, UniquePuuid(), now.AddMinutes(-5));
        Guid[] mine = [older, newer, never, fresh];

        var due = await host.Services.GetRequiredService<BackgroundSyncs>().DueAsync(now, Skip, CancellationToken.None);
        var ours = due.Where(d => mine.Contains(d.RiotAccountId)).ToList();

        // League first for the two synced ones, oldest first; then every history
        // nobody has synced, the never-synced League one and all four TFT ones.
        Assert.Equal((older, Game.Lol), (ours[0].RiotAccountId, ours[0].Game));
        Assert.Equal((newer, Game.Lol), (ours[1].RiotAccountId, ours[1].Game));
        Assert.All(ours.Skip(2), d => Assert.Null(d.LastSyncedAt));
        Assert.Contains(ours, d => d.RiotAccountId == never && d.Game == Game.Lol);
        Assert.Equal(4, ours.Count(d => d.Game == Game.Tft));

        Assert.DoesNotContain(ours, d => d.RiotAccountId == fresh && d.Game == Game.Lol);
    }

    [Fact]
    public async Task An_account_synced_inside_the_window_costs_no_Riot_call()
    {
        var puuid = UniquePuuid();
        var riot = new FakeRiot().WithMatchIds(puuid);
        await using var host = riot.Host(server.Factory);

        var accountId = await AddAccountAsync(host, puuid, DateTimeOffset.UtcNow.AddMinutes(-5));

        var outcome = await host.Services.GetRequiredService<BackgroundSyncs>()
            .SyncIfDueAsync(accountId, Game.Lol, Skip, CancellationToken.None);

        Assert.Equal(BackgroundSyncOutcome.Fresh, outcome);
        Assert.DoesNotContain(riot.Requests, r => r.Contains(puuid, StringComparison.Ordinal));
    }

    [Fact]
    public async Task An_account_synced_before_the_window_is_synced_again()
    {
        var puuid = UniquePuuid();
        var riot = new FakeRiot().WithMatchIds(puuid);
        await using var host = riot.Host(server.Factory);

        var before = DateTimeOffset.UtcNow.AddMinutes(-20);
        var accountId = await AddAccountAsync(host, puuid, before);

        var outcome = await host.Services.GetRequiredService<BackgroundSyncs>()
            .SyncIfDueAsync(accountId, Game.Lol, Skip, CancellationToken.None);

        Assert.Equal(BackgroundSyncOutcome.Synced, outcome);
        Assert.Contains(riot.Requests, r => r.Contains(puuid, StringComparison.Ordinal));
        Assert.True(await LastDeltaAsync(host, accountId) > before);
    }

    [Fact]
    public async Task An_account_a_post_game_ladder_is_waiting_on_is_left_to_it()
    {
        var puuid = UniquePuuid();
        var riot = new FakeRiot().WithMatchIds(puuid);
        await using var host = riot.Host(server.Factory);

        var accountId = await AddAccountAsync(host, puuid, DateTimeOffset.UtcNow.AddHours(-2));
        host.Services.GetRequiredService<PostGameSyncScheduler>().Schedule(accountId, Game.Lol);

        var outcome = await host.Services.GetRequiredService<BackgroundSyncs>()
            .SyncIfDueAsync(accountId, Game.Lol, Skip, CancellationToken.None);

        Assert.Equal(BackgroundSyncOutcome.Busy, outcome);
    }
}
