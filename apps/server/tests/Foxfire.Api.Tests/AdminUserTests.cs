using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Common;

namespace Foxfire.Api.Tests;

/// <summary>
/// Managing who is on the server.
///
/// The server is shared across the assembly and holds more than a page of
/// people, so a test finds the member it made by searching for their address —
/// which is unique — rather than reading the whole list.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class AdminUserTests(FoxfireServerFixture server)
{
    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    private async Task<HttpClient> AdminAsync() => (await server.AdminAsync()).Client;

    private static async Task<Page<AdminUser>> PageAsync(HttpClient admin, string query) =>
        (await admin.GetFromJsonAsync<Page<AdminUser>>(new Uri($"/api/admin/users/?{query}", UriKind.Relative)))!;

    /// <summary>Everybody whose name or address contains <paramref name="q"/> — one page of them.</summary>
    private static async Task<IReadOnlyList<AdminUser>> ListAsync(HttpClient admin, string q) =>
        (await PageAsync(admin, $"q={Uri.EscapeDataString(q)}")).Items;

    /// <summary>Creates an invited account on a server with signup shut, then opens it again.</summary>
    private async Task<(Session Member, InviteInfo Invite)> InvitedMemberAsync(HttpClient admin, string username)
    {
        var email = $"{Unique(username.ToLowerInvariant())}@example.com";

        var invite = (await (await admin.PostAsJsonAsync(
            new Uri("/api/admin/invites/", UriKind.Relative),
            new { email })).Content.ReadFromJsonAsync<InviteInfo>())!;

        await admin.PatchAsJsonAsync(new Uri("/api/admin/settings/", UriKind.Relative), new { publicSignup = false });

        try
        {
            using var client = server.Client();
            return (await server.RegisterAsync(client, username, email, invite.Token), invite);
        }
        finally
        {
            await admin.PatchAsJsonAsync(new Uri("/api/admin/settings/", UriKind.Relative), new { publicSignup = true });
        }
    }

    [Fact]
    public async Task The_user_list_says_who_is_an_admin_and_who_is_signed_in()
    {
        using var admin = await AdminAsync();
        using var client = server.Client();
        var member = await server.RegisterAsync(client, "Listed", $"{Unique("listed")}@example.com");

        var listed = Assert.Single(await ListAsync(admin, member.User.Email));

        Assert.Equal(member.User.Id, listed.Id);
        Assert.False(listed.IsAdmin);
        Assert.False(listed.IsDisabled);
        // They registered a moment ago, which is one live session.
        Assert.Equal(1, listed.ActiveSessions);
        Assert.False(listed.IsHeadAdmin);
        Assert.False(listed.IsConfiguredAdmin);
        Assert.Contains(
            await ListAsync(admin, FoxfireServerFixture.AdminEmail),
            u => u.Email == FoxfireServerFixture.AdminEmail && u.IsAdmin && u.IsHeadAdmin && u.IsConfiguredAdmin);
    }

    [Fact]
    public async Task Promoting_and_demoting_takes_effect()
    {
        using var admin = await AdminAsync();
        using var client = server.Client();
        var member = await server.RegisterAsync(client, "Promoted", $"{Unique("promote")}@example.com");

        await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative), new { isAdmin = true });
        Assert.True((await ListAsync(admin, member.User.Email)).Single(u => u.Id == member.User.Id).IsAdmin);

        await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative), new { isAdmin = false });
        Assert.False((await ListAsync(admin, member.User.Email)).Single(u => u.Id == member.User.Id).IsAdmin);
    }

    [Fact]
    public async Task A_role_change_ends_their_sessions()
    {
        // Roles live in an access token that cannot be revoked and lasts fifteen
        // minutes. Cutting the sessions is what makes a demotion mean something
        // before the quarter hour is up.
        using var admin = await AdminAsync();
        using var client = server.Client();
        var member = await server.RegisterAsync(client, "Cut", $"{Unique("cut")}@example.com");

        await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative), new { isAdmin = true });

        var refresh = await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = member.RefreshToken });

        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [Fact]
    public async Task A_disabled_account_cannot_sign_in_and_is_signed_out_everywhere()
    {
        using var admin = await AdminAsync();
        using var client = server.Client();
        var email = $"{Unique("disabled")}@example.com";
        var member = await server.RegisterAsync(client, "Disabled", email);

        await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative), new { isDisabled = true });

        var refresh = await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = member.RefreshToken });

        var login = await client.PostAsJsonAsync(
            new Uri("/api/auth/login", UriKind.Relative),
            new { email, password = FoxfireServerFixture.GoodPassword });

        var error = await login.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
        Assert.Equal("account_disabled", error?.Error);
    }

    [Fact]
    public async Task Re_enabling_lets_them_back_in()
    {
        using var admin = await AdminAsync();
        using var client = server.Client();
        var email = $"{Unique("restored")}@example.com";
        var member = await server.RegisterAsync(client, "Restored", email);

        await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative), new { isDisabled = true });
        await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative), new { isDisabled = false });

        var login = await client.PostAsJsonAsync(
            new Uri("/api/auth/login", UriKind.Relative),
            new { email, password = FoxfireServerFixture.GoodPassword });

        login.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Deleting_somebody_who_used_an_invite_works()
    {
        // The case the schema makes awkward. The foreign key from an invite to
        // who redeemed it is NO ACTION, because SQL Server refuses two cascading
        // paths between the same two tables — so the delete has to clear that
        // reference itself, or the database refuses it outright.
        using var admin = await AdminAsync();
        var (member, _) = await InvitedMemberAsync(admin, "Fleeting");

        var deleted = await admin.DeleteAsync(new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.DoesNotContain(await ListAsync(admin, member.User.Email), u => u.Id == member.User.Id);
    }

    [Fact]
    public async Task A_spent_invite_stays_spent_after_its_account_is_deleted()
    {
        // Which is why RedeemedAt rather than RedeemedByUserId records that an
        // invite was used. Deleting somebody must not hand their invite back out.
        using var admin = await AdminAsync();
        var (member, invite) = await InvitedMemberAsync(admin, "Spender");

        await admin.DeleteAsync(new Uri($"/api/admin/users/{member.User.Id}", UriKind.Relative));

        using var anyone = server.AnonymousClient();
        var preview = await anyone.GetFromJsonAsync<InvitePreview>(
            new Uri($"/api/invites/{invite.Token}/preview", UriKind.Relative));

        Assert.False(preview?.Usable);
        Assert.Contains("already been used", preview?.Message ?? "", StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task The_configured_admin_cannot_demote_disable_or_delete_themselves()
    {
        // There is no way back from a server with no administrator except
        // editing configuration and restarting, and a host who has to find that
        // out has already had a bad evening. The configured admin is the one
        // who is always there, so nobody can take them away from inside the
        // app — themselves included.
        var (admin, session) = await server.AdminAsync();
        using var _ = admin;

        var demote = await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{session.User.Id}", UriKind.Relative), new { isAdmin = false });
        var disable = await admin.PatchAsJsonAsync(
            new Uri($"/api/admin/users/{session.User.Id}", UriKind.Relative), new { isDisabled = true });
        var delete = await admin.DeleteAsync(
            new Uri($"/api/admin/users/{session.User.Id}", UriKind.Relative));

        foreach (var response in new[] { demote, disable, delete })
        {
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Equal("configured_admin", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
        }
    }

    [Fact]
    public async Task Members_are_found_by_name_or_address_in_any_case()
    {
        using var admin = await AdminAsync();
        using var client = server.Client();
        var stem = Guid.NewGuid().ToString("N")[..10];
        var member = await server.RegisterAsync(client, $"Findable{stem}", $"post-{stem}@example.com");

        // The username, shouted; the address, which does not contain the
        // username at all.
        Assert.Contains(await ListAsync(admin, $"FINDABLE{stem.ToUpperInvariant()}"), u => u.Id == member.User.Id);
        Assert.Contains(await ListAsync(admin, $"post-{stem}"), u => u.Id == member.User.Id);
        Assert.DoesNotContain(await ListAsync(admin, $"nobody-{stem}"), u => u.Id == member.User.Id);
    }

    [Fact]
    public async Task Members_come_a_page_at_a_time_in_name_order_with_a_total()
    {
        using var admin = await AdminAsync();
        var stem = Guid.NewGuid().ToString("N")[..10];

        for (var i = 0; i < 5; i++)
        {
            using var client = server.Client();
            await server.RegisterAsync(client, $"Paged{stem}{i}", $"paged-{stem}-{i}@example.com");
        }

        var q = $"q=paged{stem}";
        var first = await PageAsync(admin, $"{q}&limit=2");
        var second = await PageAsync(admin, $"{q}&limit=2&offset=2");
        var last = await PageAsync(admin, $"{q}&limit=2&offset=4");

        Assert.Equal(new[] { $"Paged{stem}0", $"Paged{stem}1" }, first.Items.Select(u => u.Username));
        Assert.Equal(new[] { $"Paged{stem}2", $"Paged{stem}3" }, second.Items.Select(u => u.Username));
        Assert.Equal(new[] { $"Paged{stem}4" }, last.Items.Select(u => u.Username));
        Assert.All(new[] { first, second, last }, page => Assert.Equal(5, page.Total));
    }

    [Fact]
    public async Task No_page_of_members_is_bigger_than_the_cap_or_smaller_than_one()
    {
        using var admin = await AdminAsync();

        // Blank is everybody on the shared server, which is more than one.
        var everybody = await PageAsync(admin, "limit=100000");
        var one = await PageAsync(admin, "limit=0");

        Assert.True(everybody.Items.Count <= PageRequest.MaxLimit);
        Assert.Single(one.Items);
        Assert.Equal(everybody.Total, one.Total);
    }

    [Fact]
    public async Task An_ordinary_member_cannot_manage_users()
    {
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Meddler", $"{Unique("meddle")}@example.com");
        FoxfireServerFixture.Authenticated(client, session);

        var response = await client.GetAsync(new Uri("/api/admin/users/", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private sealed record AdminUser(
        Guid Id,
        string Username,
        string Email,
        bool IsAdmin,
        bool IsHeadAdmin,
        bool IsConfiguredAdmin,
        bool IsDisabled,
        DateTimeOffset CreatedAt,
        int LinkedRiotAccounts,
        int ActiveSessions);
}
