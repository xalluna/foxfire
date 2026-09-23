#if FEATURE_YOUTUBE
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Api.Features.Recordings;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Recordings on YouTube: one per game per account, attached by the owner.
///
/// The test that matters most here is the perspective one. A recording is one
/// player's screen, so two people in the same game each see their own and
/// never each other's — and the place that rule lives is the row query, where
/// getting the key wrong would put Ahri's video on Riven's history without any
/// other test noticing.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class RecordingTests(FoxfireServerFixture server)
{
    private const string VideoA = "dQw4w9WgXcQ";
    private const string VideoB = "9bZkp7q19f0";

    private sealed record Player(HttpClient Client, Guid UserId, Guid AccountId);

    /// <summary>Somebody signed in, owning one League account.</summary>
    private async Task<Player> PlayerAsync(FoxfireDbContext db, string matchId, int championId)
    {
        var client = server.Client();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var session = await server.RegisterAsync(client, $"Rec{suffix}", $"rec-{suffix}@example.com");
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Rec{suffix}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = session.User.Id,
            LinkedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);
        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = matchId,
            Puuid = account.Puuid,
            TeamId = 100,
            ChampionId = championId,
            RoleBoundItem = 0
        });

        return new Player(FoxfireServerFixture.Authenticated(client, session), session.User.Id, account.Id);
    }

    /// <summary>One game with two tracked players in it — Ahri and Riven.</summary>
    private async Task<(string MatchId, Player Ahri, Player Riven)> GameAsync()
    {
        var matchId = $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        db.Matches.Add(new Match
        {
            MatchId = matchId,
            GameCreation = DateTimeOffset.UtcNow.AddHours(-2).ToUnixTimeMilliseconds(),
            GameDuration = 1800,
            QueueId = 420,
            PlatformId = "NA1",
            RawJson = "{}",
            FetchedAt = DateTimeOffset.UtcNow
        });

        var ahri = await PlayerAsync(db, matchId, 103);
        var riven = await PlayerAsync(db, matchId, 92);
        await db.SaveChangesAsync();

        return (matchId, ahri, riven);
    }

    private static Uri RecordingUri(Guid accountId, string matchId) =>
        new($"/api/riot-accounts/{accountId}/matches/{matchId}/recording", UriKind.Relative);

    private static object Upload(string videoId, bool replace = false) => new
    {
        youtubeVideoId = videoId,
        source = "upload",
        privacy = "unlisted",
        title = "Ahri · Ranked Solo/Duo · Victory · 12/3/8",
        durationSeconds = 1790,
        events = new[]
        {
            new { eventId = 7, name = "ChampionKill", gameTime = 342.5, videoTime = 252.5, role = "kill", label = "Riven" },
            new { eventId = 9, name = "ChampionKill", gameTime = 990.0, videoTime = 900.0, role = "death", label = "Zed" }
        },
        replace
    };

    private static async Task<JsonElement> RowAsync(HttpClient client, Guid accountId, string matchId)
    {
        var row = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/matches/{matchId}", UriKind.Relative));
        return row.GetProperty("recording");
    }

    [Fact]
    public async Task The_owner_attaches_one_and_their_row_offers_it_with_its_markers()
    {
        var (matchId, ahri, _) = await GameAsync();

        var attached = await ahri.Client.PutAsJsonAsync(RecordingUri(ahri.AccountId, matchId), Upload(VideoA));
        attached.EnsureSuccessStatusCode();

        var recording = await RowAsync(ahri.Client, ahri.AccountId, matchId);
        Assert.Equal(VideoA, recording.GetProperty("youtubeVideoId").GetString());
        Assert.Equal("unlisted", recording.GetProperty("privacy").GetString());
        Assert.True(recording.GetProperty("hasEvents").GetBoolean());

        var full = await ahri.Client.GetFromJsonAsync<MatchRecordingResponse>(RecordingUri(ahri.AccountId, matchId));
        Assert.NotNull(full);
        Assert.Equal("upload", full.Source);
        Assert.Equal(2, full.Events.Count);
        Assert.Equal("death", full.Events[1].Role);
        Assert.Equal(900.0, full.Events[1].VideoTime);
        Assert.StartsWith("Rec", full.AttachedBy);
    }

    [Fact]
    public async Task Each_player_in_the_same_game_sees_their_own_recording_and_never_the_other()
    {
        var (matchId, ahri, riven) = await GameAsync();

        (await ahri.Client.PutAsJsonAsync(RecordingUri(ahri.AccountId, matchId), Upload(VideoA)))
            .EnsureSuccessStatusCode();

        // Riven has none yet, and Ahri's must not stand in for it — not on
        // Riven's row, and not when anybody asks for Riven's recording.
        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, riven.AccountId, matchId)).ValueKind);
        var missing = await ahri.Client.GetAsync(RecordingUri(riven.AccountId, matchId));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        (await riven.Client.PutAsJsonAsync(RecordingUri(riven.AccountId, matchId), Upload(VideoB)))
            .EnsureSuccessStatusCode();

        // Both now, each on its own row, whoever is looking.
        Assert.Equal(VideoA, (await RowAsync(riven.Client, ahri.AccountId, matchId)).GetProperty("youtubeVideoId").GetString());
        Assert.Equal(VideoB, (await RowAsync(ahri.Client, riven.AccountId, matchId)).GetProperty("youtubeVideoId").GetString());
    }

    [Fact]
    public async Task Nobody_attaches_to_an_account_they_do_not_own_not_even_an_admin()
    {
        var (matchId, ahri, riven) = await GameAsync();
        var (admin, _) = await server.AdminAsync();

        var byRiven = await riven.Client.PutAsJsonAsync(RecordingUri(ahri.AccountId, matchId), Upload(VideoA));
        Assert.Equal(HttpStatusCode.Forbidden, byRiven.StatusCode);

        var byAdmin = await admin.PutAsJsonAsync(RecordingUri(ahri.AccountId, matchId), Upload(VideoA));
        Assert.Equal(HttpStatusCode.Forbidden, byAdmin.StatusCode);

        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, ahri.AccountId, matchId)).ValueKind);
    }

    [Fact]
    public async Task A_second_attach_asks_first_and_replaces_when_told_to()
    {
        var (matchId, ahri, _) = await GameAsync();
        var uri = RecordingUri(ahri.AccountId, matchId);

        (await ahri.Client.PutAsJsonAsync(uri, Upload(VideoA))).EnsureSuccessStatusCode();

        var again = await ahri.Client.PutAsJsonAsync(uri, Upload(VideoB));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        var error = await again.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("recording_exists", error!.Error);

        (await ahri.Client.PutAsJsonAsync(uri, Upload(VideoB, replace: true))).EnsureSuccessStatusCode();
        Assert.Equal(VideoB, (await RowAsync(ahri.Client, ahri.AccountId, matchId)).GetProperty("youtubeVideoId").GetString());
    }

    [Fact]
    public async Task A_link_pasted_with_no_events_plays_without_markers()
    {
        var (matchId, ahri, _) = await GameAsync();

        (await ahri.Client.PutAsJsonAsync(
                RecordingUri(ahri.AccountId, matchId),
                new { youtubeVideoId = VideoA, source = "link" }))
            .EnsureSuccessStatusCode();

        var recording = await RowAsync(ahri.Client, ahri.AccountId, matchId);
        Assert.False(recording.GetProperty("hasEvents").GetBoolean());
        Assert.Equal(JsonValueKind.Null, recording.GetProperty("privacy").ValueKind);
    }

    [Fact]
    public async Task The_owner_or_an_admin_can_take_it_off_and_nobody_else()
    {
        var (matchId, ahri, riven) = await GameAsync();
        var (admin, _) = await server.AdminAsync();
        var uri = RecordingUri(ahri.AccountId, matchId);

        (await ahri.Client.PutAsJsonAsync(uri, Upload(VideoA))).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Forbidden, (await riven.Client.DeleteAsync(uri)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(uri)).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, ahri.AccountId, matchId)).ValueKind);

        (await ahri.Client.PutAsJsonAsync(uri, Upload(VideoA))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await ahri.Client.DeleteAsync(uri)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ahri.Client.DeleteAsync(uri)).StatusCode);
    }

    [Fact]
    public async Task An_account_that_did_not_play_the_game_cannot_have_a_recording_of_it()
    {
        var (_, ahri, _) = await GameAsync();
        var (otherMatch, _, _) = await GameAsync();

        var refused = await ahri.Client.PutAsJsonAsync(RecordingUri(ahri.AccountId, otherMatch), Upload(VideoA));
        Assert.Equal(HttpStatusCode.NotFound, refused.StatusCode);
        Assert.Equal("not_in_match", (await refused.Content.ReadFromJsonAsync<ApiError>())!.Error);
    }

    [Theory]
    [InlineData("not-an-id", "upload", "unlisted", "invalid_video")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ", "upload", "unlisted", "invalid_video")]
    [InlineData(VideoA, "stolen", "unlisted", "invalid_source")]
    [InlineData(VideoA, "upload", "friends-only", "invalid_privacy")]
    public async Task What_is_not_a_recording_is_refused(string videoId, string source, string privacy, string code)
    {
        var (matchId, ahri, _) = await GameAsync();

        var refused = await ahri.Client.PutAsJsonAsync(
            RecordingUri(ahri.AccountId, matchId),
            new { youtubeVideoId = videoId, source, privacy });

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal(code, (await refused.Content.ReadFromJsonAsync<ApiError>())!.Error);
    }

    [Fact]
    public async Task Markers_that_no_game_produces_are_refused()
    {
        var (matchId, ahri, _) = await GameAsync();

        var tooMany = Enumerable.Range(0, 1_001)
            .Select(i => new { eventId = i, name = "ChampionKill", gameTime = 100.0, videoTime = 10.0, role = "kill", label = (string?)null })
            .ToArray();

        var refused = await ahri.Client.PutAsJsonAsync(
            RecordingUri(ahri.AccountId, matchId),
            new { youtubeVideoId = VideoA, source = "upload", events = tooMany });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

        var badRole = await ahri.Client.PutAsJsonAsync(
            RecordingUri(ahri.AccountId, matchId),
            new
            {
                youtubeVideoId = VideoA,
                source = "upload",
                events = new[] { new { eventId = 1, name = "ChampionKill", gameTime = 1.0, videoTime = 1.0, role = "teabag", label = "x" } }
            });
        Assert.Equal(HttpStatusCode.BadRequest, badRole.StatusCode);
    }

    [Fact]
    public async Task Deleting_the_game_takes_its_recordings_with_it()
    {
        var (matchId, ahri, _) = await GameAsync();
        (await ahri.Client.PutAsJsonAsync(RecordingUri(ahri.AccountId, matchId), Upload(VideoA)))
            .EnsureSuccessStatusCode();

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        await db.Matches.Where(m => m.MatchId == matchId).ExecuteDeleteAsync();

        Assert.False(await db.MatchRecordings.AnyAsync(r => r.MatchId == matchId));
    }
}
#else
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Foxfire.Api.Tests;

/// <summary>
/// A server built without YouTube: there is no route for a recording at all.
///
/// The answer is the API's own JSON 404, and its code matters. A desktop built
/// with YouTube reads <c>not_found</c> as a server that takes no recordings, and
/// keeps its own to attach once the server does, rather than marking them as
/// refused for good.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class RecordingsSwitchedOffTests(FoxfireServerFixture server)
{
    [Fact]
    public async Task A_recording_has_no_route_to_attach_read_or_remove_it()
    {
        var client = server.Client();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var session = await server.RegisterAsync(client, $"Off{suffix}", $"off-{suffix}@example.com");
        using var member = FoxfireServerFixture.Authenticated(client, session);

        var uri = new Uri($"/api/riot-accounts/{Guid.NewGuid()}/matches/NA1_1/recording", UriKind.Relative);

        HttpResponseMessage[] responses =
        [
            await member.PutAsJsonAsync(uri, new { youtubeVideoId = "dQw4w9WgXcQ", source = "link" }),
            await member.GetAsync(uri),
            await member.DeleteAsync(uri)
        ];

        foreach (var response in responses)
        {
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("not_found", body.GetProperty("error").GetString());
        }
    }
}
#endif
