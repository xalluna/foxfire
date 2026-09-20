using System.Net.Http.Json;
using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Everything the server pushes, asserted at the point it decides to.
///
/// Worth its own suite because the failure these catch is silent. An endpoint
/// that writes correctly and tells nobody looks completely healthy from every
/// other angle: the row is right, the response is right, the next refresh shows
/// it. What is wrong is that there was no next refresh — somebody's match list
/// sits on the value it had before, and the only way to notice is to have been
/// watching two windows at once.
///
/// That is exactly what happened: three of the four channels had a listener on
/// the desktop and no publisher here, and the HTTP client deliberately stopped
/// raising them locally because it expected this to.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class ServerEventTests(FoxfireServerFixture server)
{
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    /// <summary>Records instead of sending, so a test can ask what went out.</summary>
    private sealed class RecordedEvents : IServerEvents
    {
        private readonly Lock _gate = new();

        public List<SyncProgressEvent> Progress { get; } = [];
        public List<Guid> RankEdited { get; } = [];
        public List<Guid> RankChanged { get; } = [];
        public int KeyRejections { get; private set; }

        public Task SyncProgressAsync(SyncProgressEvent progress, CancellationToken cancellationToken = default)
        {
            lock (_gate) Progress.Add(progress);
            return Task.CompletedTask;
        }

        public Task RankEditedAsync(Guid riotAccountId, CancellationToken cancellationToken = default)
        {
            lock (_gate) RankEdited.Add(riotAccountId);
            return Task.CompletedTask;
        }

        public Task RankChangedAsync(Guid riotAccountId, CancellationToken cancellationToken = default)
        {
            lock (_gate) RankChanged.Add(riotAccountId);
            return Task.CompletedTask;
        }

        public Task RiotKeyRejectedAsync(CancellationToken cancellationToken = default)
        {
            lock (_gate) KeyRejections++;
            return Task.CompletedTask;
        }
    }

    /// <summary>A server whose events are recorded, signed in as somebody who owns an account.</summary>
    private async Task<(WebApplicationFactory<Program> Host, HttpClient Client, RecordedEvents Events,
        Guid AccountId, string MatchId)> RiggedAsync()
    {
        var events = new RecordedEvents();

        var host = server.Factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services => services.AddSingleton<IServerEvents>(events)));

        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var session = await server.RegisterAsync(
            server.Client(), $"Watcher{suffix}", $"watcher-{suffix}@example.com");

        FoxfireServerFixture.Authenticated(client, session);

        var now = DateTimeOffset.UtcNow;
        var matchId = $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Watched{suffix}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = session.User.Id,
            LinkedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);

        db.Matches.Add(new Match
        {
            MatchId = matchId,
            GameCreation = T0,
            GameDuration = 1800,
            QueueId = 420,
            PlatformId = "NA1",
            RawJson = "{}",
            FetchedAt = now
        });

        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = matchId,
            Puuid = account.Puuid,
            TeamId = 100,
            ChampionId = 64,
            RoleBoundItem = 0
        });

        await db.SaveChangesAsync();

        return (host, client, events, account.Id, matchId);
    }

    [Fact]
    public async Task Typing_LP_by_hand_tells_every_window()
    {
        // The window that has to react is usually not the one that called: the
        // LP editor is its own renderer with its own cache, and the match list
        // it just changed is in the main window.
        var (host, client, events, accountId, matchId) = await RiggedAsync();
        await using var _host = host;
        using var _client = client;

        var saved = await client.PostAsJsonAsync(
            new Uri($"/riot-accounts/{accountId}/rank/manual", UriKind.Relative),
            new
            {
                queueType = "RANKED_SOLO_5x5",
                edits = new[]
                {
                    new
                    {
                        matchId,
                        after = new { tier = "GOLD", rank = "II", leaguePoints = 62 },
                        before = new { tier = "GOLD", rank = "II", leaguePoints = 41 }
                    }
                }
            });

        saved.EnsureSuccessStatusCode();

        Assert.Equal([accountId], events.RankEdited);
    }

    [Fact]
    public async Task Clearing_a_hand_entered_figure_tells_every_window_too()
    {
        var (host, client, events, accountId, matchId) = await RiggedAsync();
        await using var _host = host;
        using var _client = client;

        await client.PostAsJsonAsync(
            new Uri($"/riot-accounts/{accountId}/rank/manual", UriKind.Relative),
            new
            {
                queueType = "RANKED_SOLO_5x5",
                edits = new[]
                {
                    new
                    {
                        matchId,
                        after = new { tier = "GOLD", rank = "II", leaguePoints = 62 },
                        before = new { tier = "GOLD", rank = "II", leaguePoints = 41 }
                    }
                }
            });

        var cleared = await client.DeleteAsync(
            new Uri($"/riot-accounts/{accountId}/rank/manual/{matchId}", UriKind.Relative));

        cleared.EnsureSuccessStatusCode();

        // Twice: the edit and the clear are both changes to what a match row
        // shows, and a window that missed the second would display a figure that
        // no longer exists.
        Assert.Equal([accountId, accountId], events.RankEdited);
    }

    [Fact]
    public async Task An_edit_that_was_refused_tells_nobody()
    {
        // A refresh for a change that did not happen is not harmless: it refetches
        // for everybody on the server, and it makes the failure look like it
        // partly worked.
        var (host, client, events, accountId, matchId) = await RiggedAsync();
        await using var _host = host;
        using var _client = client;

        var refused = await client.PostAsJsonAsync(
            new Uri($"/riot-accounts/{accountId}/rank/manual", UriKind.Relative),
            new
            {
                queueType = "RANKED_SOLO_5x5",
                edits = new[]
                {
                    new
                    {
                        matchId,

                        // 140 LP in a divisioned tier is not a rank that exists.
                        after = new { tier = "GOLD", rank = "II", leaguePoints = 140 },
                        before = (object?)null
                    }
                }
            });

        Assert.False(refused.IsSuccessStatusCode);
        Assert.Empty(events.RankEdited);
    }

    [Fact]
    public async Task Clearing_a_figure_that_was_never_there_tells_nobody()
    {
        var (host, client, events, accountId, matchId) = await RiggedAsync();
        await using var _host = host;
        using var _client = client;

        var missing = await client.DeleteAsync(
            new Uri($"/riot-accounts/{accountId}/rank/manual/{matchId}", UriKind.Relative));

        Assert.Equal(System.Net.HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Empty(events.RankEdited);
    }

    [Fact]
    public async Task A_rank_that_moved_tells_every_window()
    {
        var (host, client, events, accountId, _) = await RiggedAsync();
        await using var _host = host;
        using var _client = client;

        var recorded = await client.PostAsJsonAsync(
            new Uri("/rank-readings", UriKind.Relative),
            new
            {
                riotAccountId = accountId,
                queueType = "RANKED_SOLO_5x5",
                tier = "GOLD",
                division = "II",
                leaguePoints = 62,
                wins = 31,
                losses = 28,
                force = false
            });

        recorded.EnsureSuccessStatusCode();
        Assert.Equal([accountId], events.RankChanged);
    }

    [Fact]
    public async Task A_rank_that_did_not_move_tells_nobody()
    {
        // The League client is polled every ten seconds. A refresh on every one
        // of those, for every member, would be the busiest thing on the server
        // and would show nothing new.
        var (host, client, events, accountId, _) = await RiggedAsync();
        await using var _host = host;
        using var _client = client;

        var reading = new
        {
            riotAccountId = accountId,
            queueType = "RANKED_SOLO_5x5",
            tier = "SILVER",
            division = "I",
            leaguePoints = 88,
            wins = 10,
            losses = 9,
            force = false
        };

        await client.PostAsJsonAsync(new Uri("/rank-readings", UriKind.Relative), reading);
        await client.PostAsJsonAsync(new Uri("/rank-readings", UriKind.Relative), reading);

        Assert.Single(events.RankChanged);
    }
}
