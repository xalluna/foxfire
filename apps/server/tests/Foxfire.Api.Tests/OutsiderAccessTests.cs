using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Auth;
using Foxfire.Api.Configuration;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Tests;

/// <summary>
/// Reading without being a member: an open server, and a share link.
///
/// The two halves of that are the usual two. What an outsider can reach — every
/// read on an open server, one profile on a link, and never a write — and what
/// they are shown when they reach it, which is the games without who on this
/// server claimed them or what members attached.
///
/// Opening the server is a setting in the shared database, so every test that
/// opens it closes it again before it ends, whatever happens in between.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public sealed class OutsiderAccessTests(FoxfireServerFixture server)
{
    private static string Stem() => Guid.NewGuid().ToString("N")[..8];

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private async Task<RiotAccount> TrackAsync(Guid? ownerId = null)
    {
        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Shared{Stem()}",
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
        return account;
    }

    /// <summary>A stored game one player was in, with a replay a member uploaded for it.</summary>
    private async Task<string> PlayedAsync(RiotAccount account)
    {
        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var matchId = UniqueMatchId();

        db.Matches.Add(new Match
        {
            MatchId = matchId,
            GameCreation = DateTimeOffset.UtcNow.AddHours(-2).ToUnixTimeMilliseconds(),
            GameDuration = 1800,
            GameMode = "CLASSIC",
            GameType = "MATCHED_GAME",
            QueueId = 420,
            PlatformId = "NA1",
            RawJson = "{}",
            FetchedAt = DateTimeOffset.UtcNow
        });

        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = matchId,
            Puuid = account.Puuid,
            TeamId = 100,
            Win = true,
            ChampionId = 64,
            Kills = 5,
            Deaths = 2,
            Assists = 7,
            RoleBoundItem = 0
        });

        db.SharedReplays.Add(new SharedReplay
        {
            MatchId = matchId,
            BlobKey = $"replays/{matchId}.rofl",
            FileBytes = 1_000_000,
            Patch = "14.1",
            ClaimedAt = DateTimeOffset.UtcNow,
            UploadedAt = DateTimeOffset.UtcNow
        });

        await db.SaveChangesAsync();
        return matchId;
    }

    private async Task<(HttpClient Client, Session Session)> MemberAsync()
    {
        var client = server.Client();
        var stem = Stem();
        var session = await server.RegisterAsync(client, $"Sharer{stem}", $"sharer-{stem}@example.com");
        FoxfireServerFixture.Authenticated(client, session);
        return (client, session);
    }

    /// <summary>Somebody with a browser and no account, holding a share link when given one.</summary>
    private HttpClient Outsider(string? shareToken = null)
    {
        var client = server.WebClient();
        if (shareToken is not null) client.DefaultRequestHeaders.Add(ShareAccess.Header, shareToken);
        return client;
    }

    private static async Task<ShareLinkInfo> ShareAsync(HttpClient member, Guid riotAccountId)
    {
        var response = await member.PostAsJsonAsync(new Uri("/api/shares", UriKind.Relative), new { riotAccountId });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ShareLinkInfo>())!;
    }

    private static async Task<HttpStatusCode> StatusAsync(HttpClient client, string path) =>
        (await client.GetAsync(new Uri(path, UriKind.Relative))).StatusCode;

    /// <summary>Opens the server to outsiders for the length of <paramref name="test"/>, and closes it after.</summary>
    private async Task WhileOpenAsync(Func<Task> test)
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        (await admin.PatchAsJsonAsync(new Uri("/api/admin/settings/", UriKind.Relative), new { publicAccess = true }))
            .EnsureSuccessStatusCode();

        try
        {
            await test();
        }
        finally
        {
            (await admin.PatchAsJsonAsync(new Uri("/api/admin/settings/", UriKind.Relative), new { publicAccess = false }))
                .EnsureSuccessStatusCode();
        }
    }

    [Fact]
    public async Task A_server_is_closed_to_outsiders_until_an_admin_opens_it()
    {
        var account = await TrackAsync();
        using var outsider = Outsider();

        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{account.Id}/dashboard"));
        Assert.False((await outsider.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative)))!.PublicAccess);

        await WhileOpenAsync(async () =>
        {
            Assert.True((await outsider.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative)))!.PublicAccess);

            Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{account.Id}/dashboard"));
            Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{account.Id}/matches"));
            Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{account.Id}/rank/trend"));
            Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, "/api/search?q=Shared"));
            Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, "/api/seasons"));

            var mine = await outsider.GetFromJsonAsync<List<object>>(new Uri("/api/riot-accounts/mine", UriKind.Relative));
            Assert.Empty(mine!);
        });

        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{account.Id}/dashboard"));
    }

    [Fact]
    public async Task An_open_server_still_keeps_everything_but_reading_for_members()
    {
        var account = await TrackAsync();
        var matchId = await PlayedAsync(account);
        using var outsider = Outsider();

        await WhileOpenAsync(async () =>
        {
            var sync = await outsider.PostAsync(new Uri($"/api/sync/{account.Id}", UriKind.Relative), null);
            Assert.Equal(HttpStatusCode.Unauthorized, sync.StatusCode);

            var share = await outsider.PostAsJsonAsync(
                new Uri("/api/shares", UriKind.Relative), new { riotAccountId = account.Id });
            Assert.Equal(HttpStatusCode.Unauthorized, share.StatusCode);

            Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{account.Id}/rank/editable"));
            Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/replays/{matchId}"));
            Assert.Equal(
                HttpStatusCode.Unauthorized,
                await StatusAsync(outsider, $"/api/riot-accounts/{account.Id}/bind-candidates?sinceMs=0&untilMs=1"));
            Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, "/api/admin/settings/"));
        });
    }

    [Fact]
    public async Task A_share_link_opens_its_profile_and_nothing_else()
    {
        var shared = await TrackAsync();
        var other = await TrackAsync();
        var sharedGame = await PlayedAsync(shared);
        var otherGame = await PlayedAsync(other);

        var (member, _) = await MemberAsync();
        using var _member = member;
        var link = await ShareAsync(member, shared.Id);

        using var outsider = Outsider(link.Token);

        Assert.Equal(
            HttpStatusCode.OK,
            await StatusAsync(outsider, $"/api/riot-accounts/lookup?gameName={shared.GameName.ToUpperInvariant()}&tagLine=na1"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}/dashboard"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}/matches"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}/matches/{sharedGame}"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}/champions"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}/rank/periods"));
        Assert.NotEqual(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}/tft/rank/periods"));
        Assert.NotEqual(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{shared.Id}/tft/matches"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, $"/api/matches/{sharedGame}"));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(outsider, "/api/seasons?game=lol"));

        // Anybody else — a teammate on the scoreboard, a name typed into the
        // finder — is still behind sign-in.
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            await StatusAsync(outsider, $"/api/riot-accounts/lookup?gameName={other.GameName}&tagLine=NA1"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{other.Id}"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{other.Id}/dashboard"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/riot-accounts/{other.Id}/tft/matches"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/matches/{otherGame}"));
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            await StatusAsync(outsider, $"/api/riot-accounts/{other.Id}/tft/matches/{otherGame}/lobby"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, "/api/search?q=Shared"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, "/api/riot-accounts/mine"));

        // And it reads; it never writes.
        var sync = await outsider.PostAsync(new Uri($"/api/sync/{shared.Id}", UriKind.Relative), null);
        Assert.Equal(HttpStatusCode.Unauthorized, sync.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(outsider, $"/api/replays/{sharedGame}"));
    }

    [Fact]
    public async Task An_outsider_is_not_told_who_claimed_an_account_or_offered_what_members_attached()
    {
        var (member, session) = await MemberAsync();
        using var _member = member;

        var account = await TrackAsync(ownerId: session.User.Id);
        var game = await PlayedAsync(account);
        var link = await ShareAsync(member, account.Id);

        using var outsider = Outsider(link.Token);

        var asMember = await member.GetFromJsonAsync<AccountView>(new Uri($"/api/riot-accounts/{account.Id}", UriKind.Relative));
        var asOutsider = await outsider.GetFromJsonAsync<AccountView>(new Uri($"/api/riot-accounts/{account.Id}", UriKind.Relative));

        Assert.Equal(session.User.Username, asMember!.OwnerUsername);
        Assert.Null(asOutsider!.OwnerUsername);
        Assert.Null(asOutsider.OwnerId);
        Assert.False(asOutsider.IsMine);

        var memberRow = await member.GetFromJsonAsync<RowView>(
            new Uri($"/api/riot-accounts/{account.Id}/matches/{game}", UriKind.Relative));
        var outsiderRow = await outsider.GetFromJsonAsync<RowView>(
            new Uri($"/api/riot-accounts/{account.Id}/matches/{game}", UriKind.Relative));

        Assert.NotNull(memberRow!.SharedReplay);
        Assert.Null(outsiderRow!.SharedReplay);
        Assert.Null(outsiderRow.Recording);
    }

    [Fact]
    public async Task An_outsider_never_spends_the_riot_key_on_mastery()
    {
        var account = await TrackAsync();
        var (member, _) = await MemberAsync();
        using var _member = member;
        var link = await ShareAsync(member, account.Id);

        var riot = new FakeRiot();
        await using var host = riot.Host(server.Factory);

        using var outsider = host.CreateClient();
        outsider.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        outsider.DefaultRequestHeaders.Add(ShareAccess.Header, link.Token);

        var response = await outsider.GetAsync(
            new Uri($"/api/riot-accounts/{account.Id}/mastery?refresh=true", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain(riot.Requests, path => path.StartsWith("/lol/champion-mastery/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_withdrawn_lapsed_or_altered_link_opens_nothing_and_says_which()
    {
        var account = await TrackAsync();
        var (member, _) = await MemberAsync();
        using var _member = member;
        var link = await ShareAsync(member, account.Id);
        var dashboard = $"/api/riot-accounts/{account.Id}/dashboard";

        // Altered: the signature no longer matches.
        var altered = link.Token[..^2] + (link.Token[^2..] == "AA" ? "BB" : "AA");
        using (var forger = Outsider(altered))
        {
            Assert.Equal("share_link_invalid", await RefusalAsync(forger, dashboard));
        }

        // Lapsed: a link whose week is over, signed as the server signs one.
        var lapsed = await LapsedLinkAsync(account, member);
        using (var late = Outsider(lapsed))
        {
            Assert.Equal("share_link_expired", await RefusalAsync(late, dashboard));
            var open = await OpenAsync(late, lapsed);
            Assert.False(open.Usable);
            Assert.Equal("expired", open.Reason);
            Assert.Contains("expired", open.Message, StringComparison.OrdinalIgnoreCase);
        }

        // Withdrawn: worked a moment ago, and the next request is refused.
        using var holder = Outsider(link.Token);
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(holder, dashboard));

        var revoke = await member.DeleteAsync(new Uri($"/api/shares/{link.Id}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        Assert.Equal("share_link_withdrawn", await RefusalAsync(holder, dashboard));
        var withdrawn = await OpenAsync(holder, link.Token);
        Assert.False(withdrawn.Usable);
        Assert.Equal("withdrawn", withdrawn.Reason);
        Assert.Contains("withdrawn", withdrawn.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_working_link_asked_for_somebody_else_says_so_and_nobody_else_is_told_anything()
    {
        var shared = await TrackAsync();
        var other = await TrackAsync();
        var (member, _) = await MemberAsync();
        using var _member = member;
        var link = await ShareAsync(member, shared.Id);

        using var holder = Outsider(link.Token);
        Assert.Equal("not_shared", await RefusalAsync(holder, $"/api/riot-accounts/{other.Id}/dashboard"));

        // Without a link, a refusal is the bare one it always was.
        using var stranger = Outsider();
        var bare = await stranger.GetAsync(new Uri($"/api/riot-accounts/{other.Id}/dashboard", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Unauthorized, bare.StatusCode);
        Assert.Equal(0, bare.Content.Headers.ContentLength ?? 0);
    }

    /// <summary>The code a refused read answers with, having checked it was a refusal.</summary>
    private static async Task<string?> RefusalAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(new Uri(path, UriKind.Relative));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ApiError>())?.Error;
    }

    [Fact]
    public async Task Opening_a_link_says_whose_profile_it_is()
    {
        var account = await TrackAsync();
        var (member, _) = await MemberAsync();
        using var _member = member;
        var link = await ShareAsync(member, account.Id);

        using var outsider = Outsider();
        var open = await OpenAsync(outsider, link.Token);

        Assert.True(open.Usable);
        Assert.Equal(account.Id, open.RiotAccountId);
        Assert.Equal(account.GameName, open.GameName);
        Assert.Equal(account.TagLine, open.TagLine);
        Assert.Equal(link.ExpiresAt, open.ExpiresAt);

        var nonsense = await OpenAsync(outsider, "not-a-token");
        Assert.False(nonsense.Usable);
        Assert.Null(nonsense.RiotAccountId);
    }

    [Fact]
    public async Task Sharing_again_soon_hands_back_the_same_link_for_a_week()
    {
        var account = await TrackAsync();
        var (member, session) = await MemberAsync();
        using var _member = member;

        var first = await ShareAsync(member, account.Id);
        var again = await ShareAsync(member, account.Id);

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(first.Token, again.Token);
        Assert.Equal(session.User.Username, first.CreatedBy);
        Assert.InRange(first.ExpiresAt - first.CreatedAt, TimeSpan.FromDays(7) - TimeSpan.FromSeconds(1), TimeSpan.FromDays(7));

        // Somebody else sharing the same profile gets a link of their own.
        var (another, _) = await MemberAsync();
        using var _another = another;
        Assert.NotEqual(first.Id, (await ShareAsync(another, account.Id)).Id);
    }

    [Fact]
    public async Task Only_whoever_shared_a_link_or_an_admin_can_withdraw_it()
    {
        var account = await TrackAsync();
        var (sharer, _) = await MemberAsync();
        var (bystander, _) = await MemberAsync();
        var (admin, _) = await server.AdminAsync();
        using var _sharer = sharer;
        using var _bystander = bystander;
        using var _admin = admin;

        var link = await ShareAsync(sharer, account.Id);

        var refused = await bystander.DeleteAsync(new Uri($"/api/shares/{link.Id}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("not_your_share_link", (await refused.Content.ReadFromJsonAsync<ApiError>())?.Error);

        var listed = await admin.GetFromJsonAsync<SharePage>(new Uri("/api/admin/shares?limit=100", UriKind.Relative));
        Assert.Contains(listed!.Items, s => s.Id == link.Id);

        var withdrawn = await admin.DeleteAsync(new Uri($"/api/shares/{link.Id}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NoContent, withdrawn.StatusCode);

        var after = await admin.GetFromJsonAsync<SharePage>(new Uri("/api/admin/shares?limit=100", UriKind.Relative));
        Assert.DoesNotContain(after!.Items, s => s.Id == link.Id);

        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(sharer, "/api/admin/shares"));
    }

    [Fact]
    public async Task A_member_is_never_held_to_the_link_they_happen_to_carry()
    {
        var shared = await TrackAsync();
        var other = await TrackAsync();
        var (member, _) = await MemberAsync();
        using var _member = member;

        var link = await ShareAsync(member, shared.Id);
        member.DefaultRequestHeaders.Add(ShareAccess.Header, link.Token);

        Assert.Equal(HttpStatusCode.OK, await StatusAsync(member, $"/api/riot-accounts/{other.Id}/dashboard"));
    }

    private static async Task<ShareOpenInfo> OpenAsync(HttpClient client, string token)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/shares/open", UriKind.Relative), new { token });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ShareOpenInfo>())!;
    }

    /// <summary>A link whose week ended an hour ago, and its token.</summary>
    private async Task<string> LapsedLinkAsync(RiotAccount account, HttpClient member)
    {
        var me = await member.GetFromJsonAsync<SessionUser>(new Uri("/api/auth/me", UriKind.Relative));

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var auth = scope.ServiceProvider.GetRequiredService<IOptions<AuthOptions>>().Value;
        var now = DateTimeOffset.UtcNow;

        var link = new ShareLink
        {
            Id = Guid.CreateVersion7(now),
            RiotAccountId = account.Id,
            CreatedByUserId = me!.Id,
            CreatedAt = now.AddDays(-8),
            ExpiresAt = now.AddHours(-1)
        };

        db.ShareLinks.Add(link);
        await db.SaveChangesAsync();

        return ShareToken.Issue(link.Id, link.ExpiresAt, auth.InviteSigningKeyBytes);
    }

    private sealed record ShareLinkInfo(
        Guid Id,
        Guid RiotAccountId,
        string GameName,
        string TagLine,
        string Token,
        DateTimeOffset CreatedAt,
        DateTimeOffset ExpiresAt,
        string? CreatedBy);

    private sealed record SharePage(List<ShareLinkInfo> Items, int Total);

    private sealed record ShareOpenInfo(
        bool Usable,
        string Message,
        Guid? RiotAccountId,
        string? GameName,
        string? TagLine,
        DateTimeOffset? ExpiresAt,
        string? Reason = null);

    private sealed record AccountView(Guid Id, Guid? OwnerId, string? OwnerUsername, bool IsMine);

    private sealed record RowView(string MatchId, object? SharedReplay, object? Recording);
}
