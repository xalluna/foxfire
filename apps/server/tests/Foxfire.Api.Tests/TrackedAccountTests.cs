using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Features.RiotAccounts;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Tracking somebody nobody here has claimed, and keeping them current.
///
/// The two halves of one idea. An admin can start tracking an account that
/// belongs to no member, and because it belongs to no member there is nobody
/// whose desktop would ever refresh it — so a sync stopped being the owner's
/// alone, and a cooldown took over the job of protecting the Riot key.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class TrackedAccountTests(FoxfireServerFixture server)
{
    /// <summary>A member who is not an admin and owns nothing.</summary>
    private async Task<HttpClient> MemberAsync(WebApplicationFactory<Program>? host = null)
    {
        using var registrar = server.Client();
        var session = await server.RegisterAsync(
            registrar,
            $"Member{Guid.NewGuid().ToString("N")[..8]}",
            $"member-{Guid.NewGuid():N}@example.com");

        var client = host is null ? server.Client() : host.CreateClient();
        if (host is not null) client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

        return FoxfireServerFixture.Authenticated(client, session);
    }

    // ---- Adding ----------------------------------------------------------

    [Fact]
    public async Task An_admin_adds_an_account_and_it_arrives_claimed_by_nobody()
    {
        var gameName = $"Tracked{Guid.NewGuid().ToString("N")[..8]}";
        var puuid = $"puuid-{Guid.NewGuid():N}";

        var riot = new FakeRiot().WithAccount(gameName, "KR", puuid);
        await using var host = riot.Host(server.Factory);

        var (fixtureClient, session) = await server.AdminAsync();
        fixtureClient.Dispose();

        using var client = FoxfireServerFixture.Authenticated(host.CreateClient(), session);
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

        var response = await client.PostAsJsonAsync(
            new Uri("/api/admin/riot-accounts", UriKind.Relative),
            new { gameName, tagLine = "KR" });

        response.EnsureSuccessStatusCode();
        var account = await response.Content.ReadFromJsonAsync<RiotAccountResponse>();

        // Unclaimed is the point. Adding somebody to a server is not the same
        // act as saying they are you, and the admin doing it does not become
        // their owner.
        Assert.NotNull(account);
        Assert.Null(account.OwnerId);
        Assert.Null(account.OwnerUsername);
        Assert.False(account.IsMine);

        // And it really is on the row, not just in the answer.
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var stored = await db.RiotAccounts.SingleAsync(a => a.Puuid == puuid);
        Assert.Null(stored.OwnerId);
        Assert.Null(stored.LinkedAt);
    }

    [Fact]
    public async Task Adding_an_account_this_server_already_has_is_refused()
    {
        var gameName = $"Twice{Guid.NewGuid().ToString("N")[..8]}";
        var puuid = $"puuid-{Guid.NewGuid():N}";

        var riot = new FakeRiot().WithAccount(gameName, "KR", puuid);
        await using var host = riot.Host(server.Factory);

        var (fixtureClient, session) = await server.AdminAsync();
        fixtureClient.Dispose();

        using var client = FoxfireServerFixture.Authenticated(host.CreateClient(), session);
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

        var body = new { gameName, tagLine = "KR" };
        var first = await client.PostAsJsonAsync(new Uri("/api/admin/riot-accounts", UriKind.Relative), body);
        first.EnsureSuccessStatusCode();

        var again = await client.PostAsJsonAsync(new Uri("/api/admin/riot-accounts", UriKind.Relative), body);

        // Said rather than silently succeeding: an admin who typed a Riot ID
        // expecting to start tracking it should learn its history is already
        // here.
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        var error = await again.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("already_tracked", error?.Error);
    }

    [Fact]
    public async Task An_ordinary_member_cannot_add_one()
    {
        using var client = await MemberAsync();

        var response = await client.PostAsJsonAsync(
            new Uri("/api/admin/riot-accounts", UriKind.Relative),
            new { gameName = "Someone", tagLine = "NA1" });

        // Spending the community's Riot key on a stranger, and growing the
        // database by their whole history, is a decision about the server.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- Refreshing ------------------------------------------------------

    /// <summary>An unclaimed account, optionally synced a given moment ago.</summary>
    private static async Task<Guid> TrackedAsync(FoxfireDbContext db, TimeSpan? syncedAgo = null)
    {
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Stale{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);

        if (syncedAgo is { } ago)
        {
            db.SyncStates.Add(new SyncState
            {
                RiotAccountId = account.Id,
                BackfillComplete = true,
                BackfillTarget = 200,
                LastFullSyncAt = now - ago,
                LastDeltaSyncAt = now - ago
            });
        }

        await db.SaveChangesAsync();
        return account.Id;
    }

    [Fact]
    public async Task Anybody_signed_in_can_refresh_an_account_they_do_not_own()
    {
        // Nothing for it to fetch, so the run this starts is a no-op — the
        // assertion is about who is allowed to ask, not about what comes back.
        await using var host = new FakeRiot().Host(server.Factory);

        Guid accountId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            accountId = await TrackedAsync(scope.ServiceProvider.GetRequiredService<FoxfireDbContext>());
        }

        using var client = await MemberAsync(host);

        var response = await client.PostAsync(
            new Uri($"/api/sync/{accountId}", UriKind.Relative), content: null);

        // It belongs to nobody, nothing on this server syncs on a timer, and
        // the post-game ladder needs a League client nobody is running for it.
        // Owner-only would mean its history froze the day it was added.
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task A_second_refresh_inside_the_cooldown_is_refused()
    {
        await using var host = new FakeRiot().Host(server.Factory);

        Guid accountId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            accountId = await TrackedAsync(
                scope.ServiceProvider.GetRequiredService<FoxfireDbContext>(),
                syncedAgo: TimeSpan.FromSeconds(10));
        }

        using var client = await MemberAsync(host);

        var response = await client.PostAsync(
            new Uri($"/api/sync/{accountId}", UriKind.Relative), content: null);

        // Per account rather than per person: twenty members opening the same
        // profile should cost one sync, not twenty.
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);

        var error = await response.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("sync_too_soon", error?.Error);
    }

    [Fact]
    public async Task Refreshing_an_account_that_does_not_exist_is_a_404()
    {
        using var client = await MemberAsync();

        var response = await client.PostAsync(
            new Uri($"/api/sync/{Guid.CreateVersion7()}", UriKind.Relative), content: null);

        // No longer 403 not_your_account: with ownership out of the way there
        // is nothing to hide, and "no such account" is the honest answer.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
