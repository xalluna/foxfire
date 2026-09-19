using System.Net;
using System.Net.Http.Json;
using System.Text;
using Foxfire.Api.Endpoints;
using Foxfire.Api.Features.Replays;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Sharing a .rofl, against a real blob store.
///
/// Azurite rather than a fake, because the part most likely to be wrong is the
/// part a fake would skip: a SAS is a signature over a container name, a blob
/// name, a permission set and a validity window, and every one of those is a way
/// to mint a URL that looks right and is refused. These tests upload through the
/// URL the server handed out and read the bytes back through another, so a
/// signature that does not work fails here rather than on somebody's evening.
///
/// The server never touches a replay in any of this, which is the design and not
/// an incidental: the bytes go from this test straight to the store, exactly as
/// they would from a desktop.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class ReplayTests(FoxfireServerFixture server)
{
    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    /// <summary>
    /// Not a real replay, and it does not need to be.
    ///
    /// Nothing on the server parses one — the desktop reads the header before it
    /// ever offers an upload, and the client plays the file. What is being
    /// asserted is that the bytes that went up are the bytes that come down.
    /// </summary>
    private static byte[] Rofl(string marker) =>
        Encoding.UTF8.GetBytes($"RIOT\0\0{marker}{new string('r', 4096)}");

    /// <summary>A second person on the same server, for the tests that need two.</summary>
    private async Task<(HttpClient Client, Guid UserId)> MemberAsync()
    {
        var client = server.Client();
        var suffix = Guid.NewGuid().ToString("N")[..8];

        var session = await server.RegisterAsync(client, $"Viewer{suffix}", $"viewer-{suffix}@example.com");
        return (FoxfireServerFixture.Authenticated(client, session), session.User.Id);
    }

    /// <summary>Claims, uploads and completes — the whole path, as the desktop walks it.</summary>
    private static async Task<SharedReplayResponse> UploadAsync(
        HttpClient client,
        string matchId,
        byte[] bytes,
        string patch = "15.16")
    {
        var claim = await client.PostAsJsonAsync(
            new Uri("/replays/claim", UriKind.Relative),
            new
            {
                matchId,
                gameVersion = $"{patch}.700.1234",
                patch,
                durationSeconds = 1800,
                fileBytes = bytes.Length
            });

        claim.EnsureSuccessStatusCode();
        var grant = (await claim.Content.ReadFromJsonAsync<ReplayUploadGrant>())!;

        // Straight to the store, with no Foxfire token on it. The signed URL is
        // the whole of the authorisation, which is what keeps 30 MB off the
        // server's upstream.
        using var direct = new HttpClient();
        using var content = new ByteArrayContent(bytes);
        content.Headers.Add("x-ms-blob-type", "BlockBlob");

        var put = await direct.PutAsync(new Uri(grant.UploadUrl), content);
        put.EnsureSuccessStatusCode();

        var complete = await client.PostAsync(
            new Uri($"/replays/{matchId}/complete", UriKind.Relative), null);

        complete.EnsureSuccessStatusCode();
        return (await complete.Content.ReadFromJsonAsync<SharedReplayResponse>())!;
    }

    [Fact]
    public async Task A_replay_uploaded_by_one_member_downloads_for_another()
    {
        // The whole feature in one test: a game somebody else played, watchable
        // from inside your own client, for the cost of one upload nobody had to
        // coordinate.
        var matchId = UniqueMatchId();
        var bytes = Rofl(matchId);

        var (uploader, _) = await MemberAsync();
        using var _uploader = uploader;

        var stored = await UploadAsync(uploader, matchId, bytes);

        Assert.Equal(matchId, stored.MatchId);
        Assert.Equal("15.16", stored.Patch);

        // The size the store reported, not the size the client claimed.
        Assert.Equal(bytes.Length, stored.FileBytes);
        Assert.NotNull(stored.UploadedAt);

        var (viewer, _) = await MemberAsync();
        using var _viewer = viewer;

        var grant = await viewer.GetFromJsonAsync<ReplayDownloadGrant>(
            new Uri($"/replays/{matchId}/download", UriKind.Relative));

        Assert.NotNull(grant);

        using var direct = new HttpClient();
        var downloaded = await direct.GetByteArrayAsync(new Uri(grant.DownloadUrl));

        Assert.Equal(bytes, downloaded);
    }

    [Fact]
    public async Task The_second_person_in_a_game_is_told_it_is_already_covered()
    {
        // Nine of the ten people in a game have the same file and will all offer
        // it. One wins; the rest are told so, which is an ordinary outcome and
        // not a failure — the desktop treats it as "already covered".
        var matchId = UniqueMatchId();

        var (first, _) = await MemberAsync();
        using var _first = first;
        await UploadAsync(first, matchId, Rofl(matchId));

        var (second, _) = await MemberAsync();
        using var _second = second;

        var claim = await second.PostAsJsonAsync(
            new Uri("/replays/claim", UriKind.Relative),
            new { matchId, gameVersion = "15.16.700.1234", patch = "15.16", durationSeconds = 1800, fileBytes = 4096 });

        Assert.Equal(HttpStatusCode.Conflict, claim.StatusCode);

        var error = await claim.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("already_uploaded", error?.Error);
    }

    [Fact]
    public async Task A_claim_nobody_finished_is_not_offered_as_a_replay()
    {
        // An upload that never landed must not be advertised: the failure would
        // happen after somebody had waited for the download.
        var matchId = UniqueMatchId();

        var (client, _) = await MemberAsync();
        using var _client = client;

        var claim = await client.PostAsJsonAsync(
            new Uri("/replays/claim", UriKind.Relative),
            new { matchId, gameVersion = "15.16.700.1234", patch = "15.16", durationSeconds = 1800, fileBytes = 4096 });

        claim.EnsureSuccessStatusCode();

        var described = await client.GetAsync(new Uri($"/replays/{matchId}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, described.StatusCode);

        var download = await client.GetAsync(new Uri($"/replays/{matchId}/download", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    [Fact]
    public async Task Saying_an_upload_finished_is_not_evidence_that_it_did()
    {
        // The claim is made and nothing is uploaded. Completing it asks the store
        // rather than believing the caller, and the store says there is nothing
        // there.
        var matchId = UniqueMatchId();

        var (client, _) = await MemberAsync();
        using var _client = client;

        await client.PostAsJsonAsync(
            new Uri("/replays/claim", UriKind.Relative),
            new { matchId, gameVersion = "15.16.700.1234", patch = "15.16", durationSeconds = 1800, fileBytes = 4096 });

        var complete = await client.PostAsync(
            new Uri($"/replays/{matchId}/complete", UriKind.Relative), null);

        Assert.Equal(HttpStatusCode.Conflict, complete.StatusCode);

        var error = await complete.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("upload_missing", error?.Error);
    }

    [Fact]
    public async Task Only_the_uploader_or_an_admin_can_remove_one()
    {
        // Everybody can read it; one careless member should not be able to empty
        // the library. Anybody who played the game can upload it again, which is
        // what makes the deletion recoverable rather than destructive.
        var matchId = UniqueMatchId();

        var (uploader, _) = await MemberAsync();
        using var _uploader = uploader;
        await UploadAsync(uploader, matchId, Rofl(matchId));

        var (stranger, _) = await MemberAsync();
        using var _stranger = stranger;

        var refused = await stranger.DeleteAsync(new Uri($"/replays/{matchId}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);

        var removed = await uploader.DeleteAsync(new Uri($"/replays/{matchId}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);

        // And the blob went with the row, so the space is actually freed.
        var download = await uploader.GetAsync(new Uri($"/replays/{matchId}/download", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    [Fact]
    public async Task An_admin_can_remove_somebody_elses()
    {
        var matchId = UniqueMatchId();

        var (uploader, _) = await MemberAsync();
        using var _uploader = uploader;
        await UploadAsync(uploader, matchId, Rofl(matchId));

        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        var removed = await admin.DeleteAsync(new Uri($"/replays/{matchId}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
    }

    [Fact]
    public async Task A_storage_cap_refuses_the_claim_rather_than_the_upload()
    {
        // Checked before the URL is handed out, so a refused replay costs a
        // request rather than thirty megabytes of somebody's upstream — and the
        // message says what is still true, because everything already uploaded
        // keeps working.
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        var original = await admin.GetFromJsonAsync<ServerSettings>(
            new Uri("/admin/settings/", UriKind.Relative));

        try
        {
            // One byte, which nothing fits inside.
            var capped = await admin.PatchAsJsonAsync(
                new Uri("/admin/settings/", UriKind.Relative),
                new { replayByteCap = 1 });

            capped.EnsureSuccessStatusCode();

            var (client, _) = await MemberAsync();
            using var _client = client;

            var claim = await client.PostAsJsonAsync(
                new Uri("/replays/claim", UriKind.Relative),
                new
                {
                    matchId = UniqueMatchId(),
                    gameVersion = "15.16.700.1234",
                    patch = "15.16",
                    durationSeconds = 1800,
                    fileBytes = 4096
                });

            Assert.Equal(HttpStatusCode.InsufficientStorage, claim.StatusCode);

            var error = await claim.Content.ReadFromJsonAsync<ApiError>();
            Assert.Equal("storage_full", error?.Error);
        }
        finally
        {
            // The server is shared across the suite, and a cap left behind would
            // fail every replay test that runs after this one.
            await admin.PatchAsJsonAsync(
                new Uri("/admin/settings/", UriKind.Relative),
                new { replayByteCap = original?.ReplayByteCap ?? 0 });
        }
    }

    [Fact]
    public async Task No_cap_is_the_default_and_lets_everything_through()
    {
        // A cap nobody chose is a cap that surprises somebody, and what it
        // prevents is an upload being refused — which is exactly what it does.
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        var settings = await admin.GetFromJsonAsync<ServerSettings>(
            new Uri("/admin/settings/", UriKind.Relative));

        Assert.Equal(0, settings?.ReplayByteCap);

        var matchId = UniqueMatchId();
        var (client, _) = await MemberAsync();
        using var _client = client;

        var stored = await UploadAsync(client, matchId, Rofl(matchId));
        Assert.NotNull(stored.UploadedAt);
    }

    [Fact]
    public async Task A_match_row_says_which_patch_its_replay_needs()
    {
        // The row advertises the patch and not a URL. Whether this viewer can
        // play it depends on which League installs are on their machine, which
        // is theirs to know — and a download URL is a credential, minted when
        // somebody asks rather than printed on every row of a page.
        var (client, userId) = await MemberAsync();
        using var _client = client;

        var matchId = UniqueMatchId();
        var now = DateTimeOffset.UtcNow;
        var gameCreation = now.ToUnixTimeMilliseconds() - 3_600_000;

        Guid accountId;
        await using (var scope = server.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            var account = new RiotAccount
            {
                Id = Guid.CreateVersion7(now),
                Puuid = $"puuid-{Guid.NewGuid():N}",
                GameName = $"Replayer{Guid.NewGuid().ToString("N")[..8]}",
                TagLine = "NA1",
                Platform = "na1",
                RegionalRoute = "americas",
                OwnerId = userId,
                LinkedAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };

            db.RiotAccounts.Add(account);
            accountId = account.Id;

            db.Matches.Add(new Match
            {
                MatchId = matchId,
                GameCreation = gameCreation,
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
        }

        var before = await client.GetFromJsonAsync<List<System.Text.Json.JsonElement>>(
            new Uri($"/riot-accounts/{accountId}/matches", UriKind.Relative));

        Assert.NotNull(before);
        Assert.Equal(
            System.Text.Json.JsonValueKind.Null,
            before[0].GetProperty("sharedReplay").ValueKind);

        await UploadAsync(client, matchId, Rofl(matchId), patch: "15.14");

        var after = await client.GetFromJsonAsync<List<System.Text.Json.JsonElement>>(
            new Uri($"/riot-accounts/{accountId}/matches", UriKind.Relative));

        Assert.NotNull(after);

        var shared = after[0].GetProperty("sharedReplay");
        Assert.Equal("15.14", shared.GetProperty("patch").GetString());
        Assert.True(shared.GetProperty("fileBytes").GetInt64() > 0);
    }

    /// <summary>
    /// A URL signed against one address still works when handed out on another.
    ///
    /// This is what lets a self-hoster work at all. Under docker-compose the
    /// server reaches Azurite at http://blob:10000, a name that exists only on
    /// that network, while the desktop doing the uploading is on somebody's PC.
    /// So the URL is signed against the server's view and then put on an
    /// address the desktop can reach, which is only sound because a SAS signs
    /// the container and blob path and not the host.
    ///
    /// Asserted against a real Azurite rather than by comparing strings,
    /// because the claim being made is about what the *store* accepts. The two
    /// spellings here both reach the same container, so the signature is the
    /// only thing that can fail — and it did fail in the original, which minted
    /// URLs nothing outside Docker could resolve.
    /// </summary>
    [Fact]
    public async Task A_signed_url_survives_being_moved_to_the_address_a_desktop_can_reach()
    {
        var direct = new Uri(
            new Azure.Storage.Blobs.BlobServiceClient(server.BlobConnectionString).Uri,
            "/");

        // Same endpoint, deliberately written another way — as "the address the
        // desktop uses" differs from "the address the server uses".
        var elsewhere = new UriBuilder(direct)
        {
            Host = direct.Host == "127.0.0.1" ? "localhost" : "127.0.0.1"
        }.Uri;

        var storage = new Foxfire.Storage.AzureBlobReplayStorage(
            server.BlobConnectionString,
            elsewhere.GetLeftPart(UriPartial.Authority));

        await storage.PrepareAsync();

        var matchId = UniqueMatchId();
        var grant = await storage.GrantUploadAsync(matchId);

        Assert.Equal(elsewhere.Host, grant.Url.Host);
        Assert.NotEqual(direct.Host, grant.Url.Host);

        var bytes = Rofl(matchId);

        using var uploader = new HttpClient();
        using var content = new ByteArrayContent(bytes);
        content.Headers.Add("x-ms-blob-type", "BlockBlob");

        var put = await uploader.PutAsync(grant.Url, content);
        Assert.True(
            put.IsSuccessStatusCode,
            $"the store refused a rebased URL with {(int)put.StatusCode}: "
            + await put.Content.ReadAsStringAsync());

        // And the server, looking at its own address, sees what was uploaded to
        // the other one — the same blob, reached both ways.
        Assert.Equal(bytes.Length, await storage.SizeOfAsync(grant.BlobKey));

        var download = await storage.GrantDownloadAsync(grant.BlobKey);
        Assert.Equal(elsewhere.Host, download.Url.Host);
        Assert.Equal(bytes, await uploader.GetByteArrayAsync(download.Url));
    }

    /// <summary>
    /// With no public address configured, URLs are handed out exactly as signed.
    ///
    /// That is the real-Azure case, and the case of a store already reachable
    /// at the name the server uses — neither should be rewritten.
    /// </summary>
    [Fact]
    public async Task Without_a_public_address_a_signed_url_is_left_alone()
    {
        var storage = new Foxfire.Storage.AzureBlobReplayStorage(server.BlobConnectionString);
        var expected = new Azure.Storage.Blobs.BlobServiceClient(server.BlobConnectionString).Uri;

        var grant = await storage.GrantUploadAsync(UniqueMatchId());

        Assert.Equal(expected.Host, grant.Url.Host);
        Assert.Equal(expected.Port, grant.Url.Port);
    }
}
