using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Api.Common;
using Foxfire.Api.Telemetry;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Recordings on Foxfire Media: one per game per account, uploaded by the owner
/// straight to Foxfire Media with a token this server mints.
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
    private FakeMedia Media => server.Media;

    private sealed record Player(HttpClient Client, Guid UserId, Guid AccountId);

    private sealed record Ticket(string VideoId, string UploadUrl, string UploadToken, DateTimeOffset ExpiresAt, long MaxBytes);

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

    private static Uri RecordingUri(Guid accountId, string matchId, string tail = "") =>
        new($"/api/riot-accounts/{accountId}/matches/{matchId}/recording{tail}", UriKind.Relative);

    private static object Upload(bool replace = false, long sizeBytes = 4_294_967_296) => new
    {
        title = "Ahri · Ranked Solo/Duo · Victory · 12/3/8",
        filename = "2026-11-10 20-14-03.mp4",
        sizeBytes,
        durationSeconds = 1790,
        events = new[]
        {
            new { eventId = 7, name = "ChampionKill", gameTime = 342.5, videoTime = 252.5, role = "kill", label = "Riven" },
            new { eventId = 9, name = "ChampionKill", gameTime = 990.0, videoTime = 900.0, role = "death", label = "Zed" }
        },
        replace
    };

    private static async Task<Ticket> StartAsync(Player player, string matchId, bool replace = false)
    {
        var response = await player.Client.PostAsJsonAsync(RecordingUri(player.AccountId, matchId, "/upload"), Upload(replace));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Ticket>())!;
    }

    /// <summary>Uploads, and has Foxfire Media say the video is ready.</summary>
    private async Task<Ticket> ReadyAsync(Player player, string matchId)
    {
        var ticket = await StartAsync(player, matchId);
        Media.Set(ticket.VideoId, "Ready", durationMs: 1_790_000);
        using var anonymous = server.AnonymousClient();
        (await anonymous.SendAsync(FakeMedia.Webhook("video.ready", ticket.VideoId, "Ready", 1_790_000))).EnsureSuccessStatusCode();
        return ticket;
    }

    private static async Task<JsonElement> RowAsync(HttpClient client, Guid accountId, string matchId)
    {
        var row = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/matches/{matchId}", UriKind.Relative));
        return row.GetProperty("recording");
    }

    private static async Task<string?> ErrorAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString();

    [Fact]
    public async Task Starting_an_upload_hands_out_a_ticket_for_foxfire_media_and_the_row_says_it_is_on_its_way()
    {
        var (matchId, ahri, _) = await GameAsync();

        var ticket = await StartAsync(ahri, matchId);

        // The bytes go to Foxfire Media, never here.
        Assert.Equal($"{FakeMedia.BaseUrl}/uploads/tus", ticket.UploadUrl);
        Assert.StartsWith("v1.", ticket.UploadToken, StringComparison.Ordinal);
        Assert.Equal(4_294_967_296, ticket.MaxBytes);

        var video = Media.Find(ticket.VideoId)!;
        Assert.Equal($"rec_{matchId}_{ahri.AccountId:N}", video.ExternalId);

        var row = await RowAsync(ahri.Client, ahri.AccountId, matchId);
        Assert.Equal(ticket.VideoId, row.GetProperty("videoId").GetString());
        Assert.Equal("uploading", row.GetProperty("status").GetString());
        Assert.True(row.GetProperty("hasEvents").GetBoolean());
    }

    [Fact]
    public async Task Once_foxfire_media_says_it_is_ready_the_row_offers_it_with_its_markers()
    {
        var (matchId, ahri, _) = await GameAsync();
        var ticket = await ReadyAsync(ahri, matchId);

        var row = await RowAsync(ahri.Client, ahri.AccountId, matchId);
        Assert.Equal("ready", row.GetProperty("status").GetString());
        Assert.Equal(1790, row.GetProperty("durationSeconds").GetInt32());

        var recording = await ahri.Client.GetFromJsonAsync<JsonElement>(RecordingUri(ahri.AccountId, matchId));
        Assert.Equal(ticket.VideoId, recording.GetProperty("videoId").GetString());
        Assert.Equal("ready", recording.GetProperty("status").GetString());
        Assert.Equal(2, recording.GetProperty("events").GetArrayLength());
        Assert.Equal("Riven", recording.GetProperty("events")[0].GetProperty("label").GetString());
        Assert.NotEqual(JsonValueKind.Null, recording.GetProperty("readyAt").ValueKind);
    }

    [Fact]
    public async Task Each_player_in_the_same_game_sees_their_own_recording_and_never_the_other()
    {
        var (matchId, ahri, riven) = await GameAsync();
        var ahris = await StartAsync(ahri, matchId);

        // Riven's history, same game: nothing, even though Ahri's is right there.
        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, riven.AccountId, matchId)).ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await ahri.Client.GetAsync(RecordingUri(riven.AccountId, matchId))).StatusCode);

        var rivens = await StartAsync(riven, matchId);
        Assert.NotEqual(ahris.VideoId, rivens.VideoId);
        Assert.Equal(rivens.VideoId, (await RowAsync(ahri.Client, riven.AccountId, matchId)).GetProperty("videoId").GetString());
        Assert.Equal(ahris.VideoId, (await RowAsync(riven.Client, ahri.AccountId, matchId)).GetProperty("videoId").GetString());
    }

    [Fact]
    public async Task Nobody_uploads_for_an_account_they_do_not_own_not_even_an_admin()
    {
        var (matchId, ahri, riven) = await GameAsync();
        var (admin, _) = await server.PlainAdminAsync();

        var asRiven = await riven.Client.PostAsJsonAsync(RecordingUri(ahri.AccountId, matchId, "/upload"), Upload());
        var asAdmin = await admin.PostAsJsonAsync(RecordingUri(ahri.AccountId, matchId, "/upload"), Upload());

        Assert.Equal(HttpStatusCode.Forbidden, asRiven.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, asAdmin.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, ahri.AccountId, matchId)).ValueKind);
    }

    [Fact]
    public async Task Asking_again_while_it_is_uploading_carries_on_with_the_same_video()
    {
        var (matchId, ahri, _) = await GameAsync();
        var first = await StartAsync(ahri, matchId);

        // The upload stalled; Foxfire Media failed it and the desktop asks again.
        Media.Set(first.VideoId, "UploadFailed", error: "idle");
        var second = await StartAsync(ahri, matchId);

        Assert.Equal(first.VideoId, second.VideoId);
        Assert.NotEqual(first.UploadToken, second.UploadToken);
        Assert.Equal(2, Media.Find(first.VideoId)!.Tickets);
    }

    [Fact]
    public async Task Asking_while_an_upload_is_still_running_is_told_so()
    {
        var (matchId, ahri, _) = await GameAsync();
        var first = await StartAsync(ahri, matchId);
        Media.Set(first.VideoId, "Uploading");

        var again = await ahri.Client.PostAsJsonAsync(RecordingUri(ahri.AccountId, matchId, "/upload"), Upload());

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("upload_in_progress", await ErrorAsync(again));
    }

    [Fact]
    public async Task A_second_upload_asks_first_and_replaces_when_told_to()
    {
        var (matchId, ahri, _) = await GameAsync();
        var first = await ReadyAsync(ahri, matchId);

        var asked = await ahri.Client.PostAsJsonAsync(RecordingUri(ahri.AccountId, matchId, "/upload"), Upload());
        Assert.Equal(HttpStatusCode.Conflict, asked.StatusCode);
        Assert.Equal("recording_exists", await ErrorAsync(asked));

        var second = await StartAsync(ahri, matchId, replace: true);

        Assert.NotEqual(first.VideoId, second.VideoId);
        Assert.Contains(first.VideoId, Media.Deleted);
        Assert.StartsWith($"rec_{matchId}_{ahri.AccountId:N}_", Media.Find(second.VideoId)!.ExternalId, StringComparison.Ordinal);
        Assert.Equal("uploading", (await RowAsync(ahri.Client, ahri.AccountId, matchId)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_first_upload_whose_answer_was_lost_finds_the_video_it_already_made()
    {
        var (matchId, ahri, _) = await GameAsync();
        var first = await StartAsync(ahri, matchId);

        // As if the row had never been saved.
        await using (var scope = server.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            await db.MatchRecordings.Where(r => r.MatchId == matchId).ExecuteDeleteAsync();
        }

        var second = await StartAsync(ahri, matchId);
        Assert.Equal(first.VideoId, second.VideoId);
    }

    [Fact]
    public async Task A_full_video_store_is_said_as_such()
    {
        var (matchId, ahri, _) = await GameAsync();
        Media.ThenFail("uploads", HttpStatusCode.InsufficientStorage);

        var response = await ahri.Client.PostAsJsonAsync(RecordingUri(ahri.AccountId, matchId, "/upload"), Upload());

        Assert.Equal(HttpStatusCode.InsufficientStorage, response.StatusCode);
        Assert.Equal("media_full", await ErrorAsync(response));
    }

    [Fact]
    public async Task A_recording_plays_from_an_embed_with_our_own_controls_only_once_it_is_ready()
    {
        var (matchId, ahri, riven) = await GameAsync();
        var ticket = await StartAsync(ahri, matchId);

        var early = await riven.Client.PostAsync(RecordingUri(ahri.AccountId, matchId, "/embed"), null);
        Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        Assert.Equal("not_ready", await ErrorAsync(early));

        Media.Set(ticket.VideoId, "Ready");
        using var anonymous = server.AnonymousClient();
        (await anonymous.SendAsync(FakeMedia.Webhook("video.ready", ticket.VideoId, "Ready"))).EnsureSuccessStatusCode();

        // Any member may watch, not only its owner.
        var embed = await riven.Client.PostAsync(RecordingUri(ahri.AccountId, matchId, "/embed"), null);
        embed.EnsureSuccessStatusCode();
        var body = await embed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal($"{FakeMedia.BaseUrl}/embed/emb_{ticket.VideoId}?controls=0", body.GetProperty("embedUrl").GetString());
    }

    [Fact]
    public async Task Somebody_on_a_share_link_reads_the_game_but_never_the_recording()
    {
        // A member posted the video for the people they play with, not for
        // whoever their profile is shared with.
        var (matchId, ahri, _) = await GameAsync();
        await ReadyAsync(ahri, matchId);

        var share = await ahri.Client.PostAsJsonAsync(
            new Uri("/api/shares", UriKind.Relative), new { riotAccountId = ahri.AccountId });
        share.EnsureSuccessStatusCode();
        var token = (await share.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;

        using var outsider = server.WebClient();
        outsider.DefaultRequestHeaders.Add(Foxfire.Api.Auth.ShareAccess.Header, token);

        Assert.Equal(JsonValueKind.Null, (await RowAsync(outsider, ahri.AccountId, matchId)).ValueKind);
        Assert.Equal(HttpStatusCode.Unauthorized, (await outsider.GetAsync(RecordingUri(ahri.AccountId, matchId))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await outsider.PostAsync(RecordingUri(ahri.AccountId, matchId, "/embed"), null)).StatusCode);
    }

    [Fact]
    public async Task A_row_foxfire_media_cannot_tell_about_is_checked_on_when_it_is_read()
    {
        // No webhook: a Foxfire Media that cannot reach this server's address.
        var (matchId, ahri, _) = await GameAsync();
        var ticket = await StartAsync(ahri, matchId);
        Media.Set(ticket.VideoId, "Ready", durationMs: 61_000);

        await using (var scope = server.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            await db.MatchRecordings.Where(r => r.MatchId == matchId)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.CheckedAt, DateTimeOffset.UtcNow.AddMinutes(-5)));
        }

        var recording = await ahri.Client.GetFromJsonAsync<JsonElement>(RecordingUri(ahri.AccountId, matchId));
        Assert.Equal("ready", recording.GetProperty("status").GetString());
        Assert.Equal(61, recording.GetProperty("durationSeconds").GetInt32());
    }

    [Fact]
    public async Task A_recording_foxfire_media_no_longer_has_goes_from_the_row_when_it_is_read()
    {
        var (matchId, ahri, _) = await GameAsync();
        var ticket = await StartAsync(ahri, matchId);

        // Foxfire Media sweeps an upload nobody finished.
        Media.Forget(ticket.VideoId);
        await using (var scope = server.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            await db.MatchRecordings.Where(r => r.MatchId == matchId)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.CheckedAt, DateTimeOffset.UtcNow.AddMinutes(-5)));
        }

        Assert.Equal(HttpStatusCode.NotFound, (await ahri.Client.GetAsync(RecordingUri(ahri.AccountId, matchId))).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, ahri.AccountId, matchId)).ValueKind);
    }

    [Fact]
    public async Task A_webhook_is_believed_only_with_the_right_signature_and_only_while_fresh()
    {
        var (matchId, ahri, _) = await GameAsync();
        var ticket = await StartAsync(ahri, matchId);
        using var anonymous = server.AnonymousClient();

        var forged = await anonymous.SendAsync(FakeMedia.Webhook("video.ready", ticket.VideoId, "Ready", key: "some-other-key-entirely-000000000"));
        var stale = await anonymous.SendAsync(FakeMedia.Webhook("video.ready", ticket.VideoId, "Ready", at: DateTimeOffset.UtcNow.AddMinutes(-30)));

        Assert.Equal(HttpStatusCode.Unauthorized, forged.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, stale.StatusCode);
        Assert.Equal("uploading", (await RowAsync(ahri.Client, ahri.AccountId, matchId)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_late_webhook_never_moves_a_recording_back()
    {
        var (matchId, ahri, _) = await GameAsync();
        var ticket = await ReadyAsync(ahri, matchId);
        using var anonymous = server.AnonymousClient();

        (await anonymous.SendAsync(FakeMedia.Webhook("video.processing", ticket.VideoId, "Processing"))).EnsureSuccessStatusCode();

        Assert.Equal("ready", (await RowAsync(ahri.Client, ahri.AccountId, matchId)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_video_deleted_on_foxfire_media_takes_the_row_with_it()
    {
        var (matchId, ahri, _) = await GameAsync();
        var ticket = await ReadyAsync(ahri, matchId);
        using var anonymous = server.AnonymousClient();

        (await anonymous.SendAsync(FakeMedia.Webhook("video.deleted", ticket.VideoId, "Deleted"))).EnsureSuccessStatusCode();

        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, ahri.AccountId, matchId)).ValueKind);
    }

    [Fact]
    public async Task Failed_processing_says_why()
    {
        var (matchId, ahri, _) = await GameAsync();
        var ticket = await StartAsync(ahri, matchId);
        using var anonymous = server.AnonymousClient();

        (await anonymous.SendAsync(FakeMedia.Webhook("video.failed", ticket.VideoId, "Failed", error: "No video stream."))).EnsureSuccessStatusCode();

        var recording = await ahri.Client.GetFromJsonAsync<JsonElement>(RecordingUri(ahri.AccountId, matchId));
        Assert.Equal("failed", recording.GetProperty("status").GetString());
        Assert.Equal("No video stream.", recording.GetProperty("error").GetString());
    }

    [Fact]
    public async Task The_owner_or_an_admin_can_take_it_off_and_nobody_else()
    {
        var (matchId, ahri, riven) = await GameAsync();
        var ticket = await ReadyAsync(ahri, matchId);
        var (admin, _) = await server.PlainAdminAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await riven.Client.DeleteAsync(RecordingUri(ahri.AccountId, matchId))).StatusCode);
        Assert.DoesNotContain(ticket.VideoId, Media.Deleted);

        (await admin.DeleteAsync(RecordingUri(ahri.AccountId, matchId))).EnsureSuccessStatusCode();
        Assert.Contains(ticket.VideoId, Media.Deleted);
        Assert.Equal(JsonValueKind.Null, (await RowAsync(ahri.Client, ahri.AccountId, matchId)).ValueKind);
    }

    [Fact]
    public async Task An_account_that_did_not_play_the_game_cannot_have_a_recording_of_it()
    {
        var (_, ahri, _) = await GameAsync();
        var (otherMatch, _, _) = await GameAsync();

        var response = await ahri.Client.PostAsJsonAsync(RecordingUri(ahri.AccountId, otherMatch, "/upload"), Upload());

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("not_in_match", await ErrorAsync(response));
    }

    [Theory]
    [InlineData("", "a.mp4", 10, "invalid_title")]
    [InlineData("Title", "", 10, "invalid_filename")]
    [InlineData("Title", "a.mp4", 0, "invalid_size")]
    public async Task What_is_not_an_upload_is_refused(string title, string filename, long sizeBytes, string code)
    {
        var (matchId, ahri, _) = await GameAsync();

        var response = await ahri.Client.PostAsJsonAsync(
            RecordingUri(ahri.AccountId, matchId, "/upload"), new { title, filename, sizeBytes });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(code, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Markers_that_no_game_produces_are_refused()
    {
        var (matchId, ahri, _) = await GameAsync();

        var badRole = await ahri.Client.PostAsJsonAsync(
            RecordingUri(ahri.AccountId, matchId, "/upload"),
            new
            {
                title = "t",
                filename = "a.mp4",
                sizeBytes = 10,
                events = new[] { new { eventId = 1, name = "ChampionKill", gameTime = 1.0, videoTime = 1.0, role = "teabag", label = "x" } }
            });
        Assert.Equal(HttpStatusCode.BadRequest, badRole.StatusCode);
    }

    [Fact]
    public async Task No_upload_token_ever_reaches_the_log()
    {
        var (matchId, ahri, _) = await GameAsync();
        await StartAsync(ahri, matchId);
        await StartAsync(ahri, matchId);

        var lines = server.Services.GetRequiredService<RecentLogs>().Read(null, PageRequest.Of(100, 0), null);
        foreach (var token in Media.Tokens)
        {
            Assert.DoesNotContain(lines.Items, line => line.Message.Contains(token, StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task Deleting_the_game_takes_its_recordings_with_it()
    {
        var (matchId, ahri, _) = await GameAsync();
        await StartAsync(ahri, matchId);

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        await db.Matches.Where(m => m.MatchId == matchId).ExecuteDeleteAsync();

        Assert.False(await db.MatchRecordings.AnyAsync(r => r.MatchId == matchId));
    }
}

/// <summary>
/// A server without Foxfire Media: there is no route for a recording at all.
///
/// The answer is the API's own JSON 404, and its code matters. A desktop reads
/// <c>not_found</c> as a server that takes no recordings, and keeps its own to
/// upload once the server does, rather than marking them refused for good.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class MediaOffTests(FoxfireServerFixture server)
{
    [Fact]
    public async Task A_recording_has_no_route_and_version_says_so()
    {
        await using var host = FakeMedia.Off(server.Factory);
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

        var version = await client.GetFromJsonAsync<JsonElement>(new Uri("/version", UriKind.Relative));
        Assert.False(version.GetProperty("recordings").GetBoolean());
        Assert.Equal(JsonValueKind.Null, version.GetProperty("mediaOrigin").ValueKind);

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var session = await server.RegisterAsync(client, $"Off{suffix}", $"off-{suffix}@example.com");
        using var member = FoxfireServerFixture.Authenticated(client, session);

        var uri = $"/api/riot-accounts/{Guid.NewGuid()}/matches/NA1_1/recording";
        HttpResponseMessage[] responses =
        [
            await member.PostAsJsonAsync(new Uri(uri + "/upload", UriKind.Relative), new { title = "t", filename = "a.mp4", sizeBytes = 1 }),
            await member.GetAsync(new Uri(uri, UriKind.Relative)),
            await member.PostAsync(new Uri(uri + "/embed", UriKind.Relative), null),
            await member.DeleteAsync(new Uri(uri, UriKind.Relative)),
            await member.PostAsync(new Uri("/api/media/webhooks", UriKind.Relative), new StringContent("{}"))
        ];

        foreach (var response in responses)
        {
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("not_found", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        }
    }

    [Fact]
    public async Task A_server_with_foxfire_media_says_where_it_is()
    {
        var version = await server.Client().GetFromJsonAsync<JsonElement>(new Uri("/version", UriKind.Relative));
        Assert.True(version.GetProperty("recordings").GetBoolean());
        Assert.Equal(FakeMedia.BaseUrl, version.GetProperty("mediaOrigin").GetString());
    }
}
