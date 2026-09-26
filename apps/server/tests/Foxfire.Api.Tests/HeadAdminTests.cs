using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// What a head admin may do that a plain admin may not.
///
/// Three things: import (see ImportTests), type LP on anybody's account, and act
/// against another admin — demote, disable, remove, or make a reset link that
/// would hand the account over. Any admin can still let somebody in. And the
/// account in Admin__Email answers to nobody from inside the app.
///
/// The configured admin is always a head admin on this shared server, so the
/// last-head-admin guard cannot be reached from here: removing the last one
/// needs a server whose configured address has not registered.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class HeadAdminTests(FoxfireServerFixture server)
{
    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..(prefix.Length + 12)];

    private static Uri Api(string path) => new(path, UriKind.Relative);

    private static Uri UserUri(Guid id) => Api($"/api/admin/users/{id}");

    private async Task<Session> MemberAsync(string name)
    {
        using var client = server.Client();
        var username = Unique(name);
        return await server.RegisterAsync(client, username, $"{username.ToLowerInvariant()}@example.com");
    }

    private static async Task<AdminUser> ListedAsync(HttpClient admin, Session who)
    {
        var page = await admin.GetFromJsonAsync<Page<AdminUser>>(
            Api($"/api/admin/users/?q={Uri.EscapeDataString(who.User.Email)}"));
        return page!.Items.Single(u => u.Id == who.User.Id);
    }

    private static async Task AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string error)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(error, (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task A_plain_admin_cannot_act_against_another_admin()
    {
        // A reset link is on this list because whoever holds it can become that
        // admin — from a plain admin it would be a way round the other three.
        var (plain, _) = await server.PlainAdminAsync("Meddler");
        using var _plain = plain;
        var (_, other) = await server.PlainAdminAsync("Target");

        var demote = await plain.PatchAsJsonAsync(UserUri(other.User.Id), new { isAdmin = false });
        var disable = await plain.PatchAsJsonAsync(UserUri(other.User.Id), new { isDisabled = true });
        var reset = await plain.PostAsync(Api($"/api/admin/users/{other.User.Id}/password-reset"), null);
        var delete = await plain.DeleteAsync(UserUri(other.User.Id));

        foreach (var response in new[] { demote, disable, reset, delete })
        {
            await AssertRefusedAsync(response, HttpStatusCode.Forbidden, "head_admin_only");
        }

        // And nothing happened to them.
        var (head, _) = await server.AdminAsync();
        using var _head = head;
        var listed = await ListedAsync(head, other);
        Assert.True(listed.IsAdmin);
        Assert.False(listed.IsDisabled);
        Assert.Null(listed.PasswordReset);
    }

    [Fact]
    public async Task A_plain_admin_is_not_shown_another_admin_s_reset_link()
    {
        // The link is the account: listing it to a plain admin would undo the
        // rule that only a head admin can make one for an admin.
        var (head, _) = await server.AdminAsync();
        using var _head = head;
        var (plain, _) = await server.PlainAdminAsync("Peeker");
        using var _plain = plain;
        var (_, other) = await server.PlainAdminAsync("Resetting");
        var member = await MemberAsync("Forgetful");

        (await head.PostAsync(Api($"/api/admin/users/{other.User.Id}/password-reset"), null)).EnsureSuccessStatusCode();
        (await head.PostAsync(Api($"/api/admin/users/{member.User.Id}/password-reset"), null)).EnsureSuccessStatusCode();

        Assert.NotNull((await ListedAsync(head, other)).PasswordReset);
        Assert.Null((await ListedAsync(plain, other)).PasswordReset);
        Assert.NotNull((await ListedAsync(plain, member)).PasswordReset);
    }

    [Fact]
    public async Task A_plain_admin_can_still_let_people_in_and_step_down()
    {
        var (plain, me) = await server.PlainAdminAsync("Doorman");
        using var _plain = plain;
        var member = await MemberAsync("Guest");
        var other = await MemberAsync("Visitor");

        // A member is not an admin, so everything is open.
        (await plain.PatchAsJsonAsync(UserUri(member.User.Id), new { isDisabled = true })).EnsureSuccessStatusCode();
        (await plain.PatchAsJsonAsync(UserUri(member.User.Id), new { isDisabled = false })).EnsureSuccessStatusCode();
        (await plain.PatchAsJsonAsync(UserUri(member.User.Id), new { isAdmin = true })).EnsureSuccessStatusCode();
        (await plain.PostAsync(Api($"/api/admin/users/{other.User.Id}/password-reset"), null)).EnsureSuccessStatusCode();

        // Stepping down is anybody's to do.
        (await plain.PatchAsJsonAsync(UserUri(me.User.Id), new { isAdmin = false })).EnsureSuccessStatusCode();

        var (head, _) = await server.AdminAsync();
        using var _head = head;
        Assert.True((await ListedAsync(head, member)).IsAdmin);
        Assert.False((await ListedAsync(head, me)).IsAdmin);
    }

    [Fact]
    public async Task A_plain_admin_can_enable_an_admin_somebody_disabled()
    {
        var (plain, _) = await server.PlainAdminAsync("Rescuer");
        using var _plain = plain;
        var (_, other) = await server.PlainAdminAsync("Locked");

        var (head, _) = await server.AdminAsync();
        using var _head = head;
        (await head.PatchAsJsonAsync(UserUri(other.User.Id), new { isDisabled = true })).EnsureSuccessStatusCode();

        (await plain.PatchAsJsonAsync(UserUri(other.User.Id), new { isDisabled = false })).EnsureSuccessStatusCode();

        Assert.False((await ListedAsync(head, other)).IsDisabled);
    }

    [Fact]
    public async Task Only_a_head_admin_makes_head_admins_and_the_roles_nest()
    {
        var (plain, _) = await server.PlainAdminAsync("Kingmaker");
        using var _plain = plain;
        var (head, _) = await server.AdminAsync();
        using var _head = head;
        var member = await MemberAsync("Heir");

        await AssertRefusedAsync(
            await plain.PatchAsJsonAsync(UserUri(member.User.Id), new { isHeadAdmin = true }),
            HttpStatusCode.Forbidden,
            "head_admin_only");

        // Head admin brings admin with it...
        (await head.PatchAsJsonAsync(UserUri(member.User.Id), new { isHeadAdmin = true })).EnsureSuccessStatusCode();
        var promoted = await ListedAsync(head, member);
        Assert.True(promoted.IsAdmin);
        Assert.True(promoted.IsHeadAdmin);

        // ...a plain admin cannot take it away...
        await AssertRefusedAsync(
            await plain.PatchAsJsonAsync(UserUri(member.User.Id), new { isHeadAdmin = false }),
            HttpStatusCode.Forbidden,
            "head_admin_only");

        // ...taking it away leaves an admin...
        (await head.PatchAsJsonAsync(UserUri(member.User.Id), new { isHeadAdmin = false })).EnsureSuccessStatusCode();
        var stepped = await ListedAsync(head, member);
        Assert.True(stepped.IsAdmin);
        Assert.False(stepped.IsHeadAdmin);

        // ...and demoting a head admin takes both.
        (await head.PatchAsJsonAsync(UserUri(member.User.Id), new { isHeadAdmin = true })).EnsureSuccessStatusCode();
        (await head.PatchAsJsonAsync(UserUri(member.User.Id), new { isAdmin = false })).EnsureSuccessStatusCode();
        var demoted = await ListedAsync(head, member);
        Assert.False(demoted.IsAdmin);
        Assert.False(demoted.IsHeadAdmin);

        // Asking for both the wrong way round is not a thing anybody can be.
        await AssertRefusedAsync(
            await head.PatchAsJsonAsync(UserUri(member.User.Id), new { isAdmin = false, isHeadAdmin = true }),
            HttpStatusCode.BadRequest,
            "invalid_roles");
    }

    [Fact]
    public async Task A_head_admin_can_act_against_another_admin()
    {
        var (head, _) = await server.AdminAsync();
        using var _head = head;
        var (_, other) = await server.PlainAdminAsync("Demotable");
        var (_, removable) = await server.PlainAdminAsync("Removable");

        (await head.PostAsync(Api($"/api/admin/users/{other.User.Id}/password-reset"), null)).EnsureSuccessStatusCode();
        (await head.PatchAsJsonAsync(UserUri(other.User.Id), new { isDisabled = true })).EnsureSuccessStatusCode();
        (await head.PatchAsJsonAsync(UserUri(other.User.Id), new { isDisabled = false })).EnsureSuccessStatusCode();
        (await head.PatchAsJsonAsync(UserUri(other.User.Id), new { isAdmin = false })).EnsureSuccessStatusCode();
        (await head.DeleteAsync(UserUri(removable.User.Id))).EnsureSuccessStatusCode();

        Assert.False((await ListedAsync(head, other)).IsAdmin);
    }

    [Fact]
    public async Task Nobody_can_demote_disable_or_remove_the_configured_admin()
    {
        // Not even another head admin. The configuration is the final say on
        // who owns the server; a demotion from here would last until the next
        // restart, and a disable or a removal would outlast it.
        var (head, configured) = await server.AdminAsync();
        using var _head = head;

        var member = await MemberAsync("Usurper");
        (await head.PatchAsJsonAsync(UserUri(member.User.Id), new { isHeadAdmin = true })).EnsureSuccessStatusCode();

        using var usurper = server.Client();
        var login = await usurper.PostAsJsonAsync(
            Api("/api/auth/login"), new { email = member.User.Email, password = FoxfireServerFixture.GoodPassword });
        FoxfireServerFixture.Authenticated(usurper, (await login.Content.ReadFromJsonAsync<Session>())!);

        var target = UserUri(configured.User.Id);
        var refused = new[]
        {
            await usurper.PatchAsJsonAsync(target, new { isAdmin = false }),
            await usurper.PatchAsJsonAsync(target, new { isHeadAdmin = false }),
            await usurper.PatchAsJsonAsync(target, new { isDisabled = true }),
            await usurper.DeleteAsync(target)
        };

        foreach (var response in refused)
        {
            await AssertRefusedAsync(response, HttpStatusCode.Conflict, "configured_admin");
        }

        // A reset link is still theirs to be sent, by another head admin: it is
        // how the configured admin gets back in after forgetting a password.
        var reset = await usurper.PostAsync(Api($"/api/admin/users/{configured.User.Id}/password-reset"), null);
        reset.EnsureSuccessStatusCode();
        (await usurper.DeleteAsync(Api($"/api/admin/users/{configured.User.Id}/password-reset"))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_plain_admin_cannot_move_onto_the_configured_address()
    {
        // The address makes a head admin at the next boot, so for a plain admin
        // it would be a promotion nobody gave them.
        var (plain, _) = await server.PlainAdminAsync("Climber");
        using var _plain = plain;

        var response = await plain.PatchAsJsonAsync(
            Api("/api/auth/email"),
            new { email = FoxfireServerFixture.AdminEmail, currentPassword = FoxfireServerFixture.GoodPassword });

        await AssertRefusedAsync(response, HttpStatusCode.BadRequest, "admin_email_reserved");
    }

    [Fact]
    public async Task A_head_admin_can_type_and_clear_LP_on_anybody_s_account()
    {
        // Somebody else's, and one nobody has claimed: a figure typed wrong, or
        // never typed, is a head admin's to fix either way.
        var (head, _) = await server.AdminAsync();
        using var _head = head;
        var owner = await MemberAsync("Owner");

        foreach (var ownerId in new Guid?[] { owner.User.Id, null })
        {
            var (accountId, matchId) = await AccountWithRankedGameAsync(ownerId);

            var editable = await head.GetAsync(Api($"/api/riot-accounts/{accountId}/rank/editable"));
            editable.EnsureSuccessStatusCode();
            Assert.Contains(matchId, await editable.Content.ReadAsStringAsync(), StringComparison.Ordinal);

            (await head.PostAsJsonAsync(Api($"/api/riot-accounts/{accountId}/rank/manual"), Edit(matchId)))
                .EnsureSuccessStatusCode();

            (await head.DeleteAsync(Api($"/api/riot-accounts/{accountId}/rank/manual/{matchId}")))
                .EnsureSuccessStatusCode();
        }
    }

    [Fact]
    public async Task A_plain_admin_types_LP_only_on_their_own_accounts()
    {
        var (plain, _) = await server.PlainAdminAsync("Scribe");
        using var _plain = plain;
        var owner = await MemberAsync("Owned");
        var (accountId, matchId) = await AccountWithRankedGameAsync(owner.User.Id);

        var refused = new[]
        {
            await plain.GetAsync(Api($"/api/riot-accounts/{accountId}/rank/editable")),
            await plain.PostAsJsonAsync(Api($"/api/riot-accounts/{accountId}/rank/manual"), Edit(matchId)),
            await plain.DeleteAsync(Api($"/api/riot-accounts/{accountId}/rank/manual/{matchId}"))
        };

        foreach (var response in refused)
        {
            await AssertRefusedAsync(response, HttpStatusCode.Forbidden, "not_your_account");
        }
    }

    private static object Edit(string matchId) => new
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
    };

    /// <summary>An account with one Solo/Duo game on it and no LP figure yet.</summary>
    private async Task<(Guid AccountId, string MatchId)> AccountWithRankedGameAsync(Guid? ownerId)
    {
        var now = DateTimeOffset.UtcNow;
        var matchId = $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = Unique("Laddered"),
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = ownerId,
            LinkedAt = ownerId is null ? null : now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);

        db.Matches.Add(new Match
        {
            MatchId = matchId,
            GameCreation = now.AddHours(-2).ToUnixTimeMilliseconds(),
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
        return (account.Id, matchId);
    }

    private sealed record AdminUser(
        Guid Id,
        string Email,
        bool IsAdmin,
        bool IsHeadAdmin,
        bool IsDisabled,
        object? PasswordReset);
}
