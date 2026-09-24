using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Features.RiotAccounts;
using Foxfire.Core;

namespace Foxfire.Api.Tests;

/// <summary>
/// The version handshake, which has to work before anything else can.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class VersionTests(FoxfireServerFixture server)
{
    [Fact]
    public async Task Version_answers_without_a_client_header_or_a_token()
    {
        // The whole reason this endpoint is exempt from the gate. A desktop too
        // old to be served has to be able to find that out and say which version
        // to install — and, from 0.14.0, to go and install it.
        using var client = server.AnonymousClient();

        var version = await client.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative));

        Assert.NotNull(version);
        Assert.Equal(FoxfireServerFixture.ServerName, version.ServerName);
        Assert.Equal(DesktopCompatibility.ApiVersion, version.ApiVersion);
        Assert.Equal(FoxfireServerFixture.CurrentDesktop, version.RecommendedDesktop);
    }

    [Fact]
    public async Task A_gated_route_refuses_a_client_that_does_not_say_what_it_is()
    {
        using var client = server.AnonymousClient();

        var response = await client.GetAsync(new Uri("/api/auth/me", UriKind.Relative));

        Assert.Equal(HttpStatusCode.UpgradeRequired, response.StatusCode);
    }

    [Fact]
    public async Task A_gated_route_refuses_an_unlisted_version_and_names_the_one_to_install()
    {
        using var client = server.Client("0.1.0");

        var response = await client.GetAsync(new Uri("/api/auth/me", UriKind.Relative));
        var error = await response.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.UpgradeRequired, response.StatusCode);
        Assert.Equal("unsupported_client", error?.Error);
        Assert.Contains(FoxfireServerFixture.CurrentDesktop, error?.Message ?? "", StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_version_gate_runs_before_authentication()
    {
        // An out-of-date client must be told it is out of date, not handed a 401
        // it cannot act on. Ordering, asserted rather than assumed.
        using var client = server.Client("0.1.0");

        var response = await client.GetAsync(new Uri("/api/auth/me", UriKind.Relative));

        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(HttpStatusCode.UpgradeRequired, response.StatusCode);
    }

    [Fact]
    public async Task Health_reports_degraded_rather_than_down_when_the_riot_key_is_refused()
    {
        // The key in this fixture is not real, so Riot rejects it. Everything
        // stored still reads — a dead key costs new data, not the whole server —
        // and an orchestrator restarting on this would achieve nothing, since
        // the key is configuration and the new process holds the same one.
        using var client = server.AnonymousClient();

        var health = await client.GetFromJsonAsync<HealthInfo>(new Uri("/health", UriKind.Relative));

        Assert.NotNull(health);
        Assert.Contains(health.Status, new[] { "healthy", "degraded" }, StringComparer.Ordinal);
    }

    private sealed record HealthInfo(string Status, bool RiotKeyRejected, int QueueDepth);
}

/// <summary>
/// Registering, signing in, and staying signed in.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class AuthTests(FoxfireServerFixture server)
{
    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    [Fact]
    public async Task The_configured_admin_email_is_an_admin()
    {
        // However it got there. Registration grants the role, and startup
        // re-grants it to whatever Admin__Email currently names — which is what
        // makes the config file the final say on who owns a server, and what
        // lets a host recover one whose last admin deleted themselves.
        var (client, session) = await server.AdminAsync();
        using var _ = client;

        Assert.True(session.User.IsAdmin);
        Assert.Equal(FoxfireServerFixture.AdminEmail, session.User.Email);
    }

    [Fact]
    public async Task An_ordinary_registration_is_not_an_admin()
    {
        using var client = server.Client();

        var session = await server.RegisterAsync(client, "Ordinary", $"{Unique("ordinary")}@example.com");

        Assert.False(session.User.IsAdmin);
    }

    [Fact]
    public async Task A_session_carries_both_tokens_and_the_access_token_works()
    {
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Whoever", $"{Unique("whoever")}@example.com");

        FoxfireServerFixture.Authenticated(client, session);
        var me = await client.GetFromJsonAsync<SessionUser>(new Uri("/api/auth/me", UriKind.Relative));

        Assert.NotEmpty(session.RefreshToken);
        Assert.Equal(session.User.Id, me?.Id);
    }

    [Fact]
    public async Task A_short_password_is_refused_with_something_readable()
    {
        using var client = server.Client();

        var response = await client.PostAsJsonAsync(
            new Uri("/api/auth/register", UriKind.Relative),
            new { username = "Brief", email = $"{Unique("brief")}@example.com", password = "short" });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("registration_failed", error?.Error);
        Assert.Contains("12", error?.Message ?? "", StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_email_cannot_be_used_twice()
    {
        using var client = server.Client();
        var email = $"{Unique("taken")}@example.com";
        await server.RegisterAsync(client, "First", email);

        var response = await client.PostAsJsonAsync(
            new Uri("/api/auth/register", UriKind.Relative),
            new { username = "Second", email, password = FoxfireServerFixture.GoodPassword });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_username_cannot_be_used_twice()
    {
        // Identity has always enforced this — it indexes NormalizedUserName
        // uniquely by default — so what this pins is the code, not the rule.
        // A taken name is the one registration failure somebody fixes by
        // changing a single box, and the desktop needs to be able to tell it
        // apart to put the message under that box.
        using var client = server.Client();

        // Kept short: the endpoint refuses anything over 32 characters, and a
        // Unique() prefix plus a full Guid is 37.
        var username = $"Twin{Guid.NewGuid().ToString("N")[..8]}";

        await server.RegisterAsync(client, username, $"{Unique("twin-first")}@example.com");

        var response = await client.PostAsJsonAsync(
            new Uri("/api/auth/register", UriKind.Relative),
            new
            {
                username,
                email = $"{Unique("twin-second")}@example.com",
                password = FoxfireServerFixture.GoodPassword
            });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("username_taken", error?.Error);
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("")]
    public async Task A_username_has_to_be_a_username(string username)
    {
        using var client = server.Client();

        var response = await client.PostAsJsonAsync(
            new Uri("/api/auth/register", UriKind.Relative),
            new { username, email = $"{Unique("named")}@example.com", password = FoxfireServerFixture.GoodPassword });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("invalid_username", error?.Error);
    }

    [Fact]
    public async Task A_wrong_password_and_an_account_that_does_not_exist_answer_identically()
    {
        // Otherwise this endpoint tells anybody who asks which addresses have
        // accounts on a private server.
        using var client = server.Client();
        var email = $"{Unique("real")}@example.com";
        await server.RegisterAsync(client, "Real", email);

        var wrongPassword = await client.PostAsJsonAsync(
            new Uri("/api/auth/login", UriKind.Relative),
            new { email, password = "not-the-right-password" });

        var noSuchAccount = await client.PostAsJsonAsync(
            new Uri("/api/auth/login", UriKind.Relative),
            new { email = $"{Unique("ghost")}@example.com", password = "not-the-right-password" });

        Assert.Equal(wrongPassword.StatusCode, noSuchAccount.StatusCode);
        Assert.Equal(
            (await wrongPassword.Content.ReadFromJsonAsync<ApiError>())?.Message,
            (await noSuchAccount.Content.ReadFromJsonAsync<ApiError>())?.Message);
    }

    [Fact]
    public async Task Refreshing_rotates_the_token_and_the_old_one_stops_working()
    {
        using var client = server.Client();
        var first = await server.RegisterAsync(client, "Rotator", $"{Unique("rotate")}@example.com");

        var refreshed = await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = first.RefreshToken });

        refreshed.EnsureSuccessStatusCode();
        var second = (await refreshed.Content.ReadFromJsonAsync<Session>())!;

        Assert.NotEqual(first.RefreshToken, second.RefreshToken);

        var replay = await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = first.RefreshToken });

        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
    }

    [Fact]
    public async Task Replaying_a_spent_token_cuts_the_whole_chain()
    {
        // A spent token being presented means a copy of it is in use somewhere.
        // The safe reading is that the chain is compromised, so its successor
        // dies too and everybody on the account signs in again.
        using var client = server.Client();
        var first = await server.RegisterAsync(client, "Replayed", $"{Unique("replay")}@example.com");

        var second = (await (await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = first.RefreshToken })).Content.ReadFromJsonAsync<Session>())!;

        // The replay, which is what trips the alarm.
        await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = first.RefreshToken });

        var successor = await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = second.RefreshToken });

        Assert.Equal(HttpStatusCode.Unauthorized, successor.StatusCode);
    }

    [Fact]
    public async Task Signing_out_works_without_a_live_access_token()
    {
        // Which is most of the time: an access token lasts fifteen minutes and
        // somebody signing out has usually been idle longer than that.
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Leaver", $"{Unique("leave")}@example.com");

        var loggedOut = await client.PostAsJsonAsync(
            new Uri("/api/auth/logout", UriKind.Relative),
            new { refreshToken = session.RefreshToken });

        Assert.Equal(HttpStatusCode.NoContent, loggedOut.StatusCode);

        var afterwards = await client.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative),
            new { refreshToken = session.RefreshToken });

        Assert.Equal(HttpStatusCode.Unauthorized, afterwards.StatusCode);
    }

    [Fact]
    public async Task Me_needs_a_token()
    {
        using var client = server.Client();

        var response = await client.GetAsync(new Uri("/api/auth/me", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

/// <summary>
/// Invites: clickable as often as anybody likes, redeemable exactly once.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class InviteTests(FoxfireServerFixture server)
{
    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    private async Task<HttpClient> AdminAsync() => (await server.AdminAsync()).Client;

    private static async Task<InviteInfo> CreateInviteAsync(HttpClient admin, string email)
    {
        var response = await admin.PostAsJsonAsync(new Uri("/api/admin/invites/", UriKind.Relative), new { email });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<InviteInfo>())!;
    }

    private async Task SetPublicSignupAsync(HttpClient admin, bool enabled)
    {
        var response = await admin.PatchAsJsonAsync(
            new Uri("/api/admin/settings/", UriKind.Relative),
            new { publicSignup = enabled });

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task An_invite_comes_back_with_a_link_an_admin_can_copy()
    {
        // SMTP is optional, so this is load-bearing rather than a convenience:
        // a host with no working mail pastes this into Discord instead.
        using var admin = await AdminAsync();

        var invite = await CreateInviteAsync(admin, $"{Unique("linked")}@example.com");

        Assert.Contains("/invite/", invite.Link, StringComparison.Ordinal);
        Assert.True(invite.IsOpen);
        Assert.Null(invite.RedeemedAt);
    }

    [Fact]
    public async Task Asking_twice_for_the_same_address_returns_the_same_invite()
    {
        // An admin who cannot remember whether they already sent one should get
        // the link that is already in somebody's inbox, not a second one.
        using var admin = await AdminAsync();
        var email = $"{Unique("twice")}@example.com";

        var first = await CreateInviteAsync(admin, email);
        var second = await CreateInviteAsync(admin, email);

        Assert.Equal(first.Id, second.Id);
        Assert.Equal(first.Token, second.Token);
    }

    [Fact]
    public async Task A_link_can_be_checked_as_many_times_as_anybody_likes()
    {
        using var admin = await AdminAsync();
        var invite = await CreateInviteAsync(admin, $"{Unique("clicked")}@example.com");

        using var anyone = server.AnonymousClient();
        for (var i = 0; i < 4; i++)
        {
            var preview = await anyone.GetFromJsonAsync<InvitePreview>(
                new Uri($"/api/invites/{invite.Token}/preview", UriKind.Relative));

            Assert.True(preview?.Usable);
        }
    }

    [Fact]
    public async Task A_valid_invite_names_the_address_it_was_sent_to()
    {
        // The desktop fills the registration form in from this. Registering with
        // any other address is refused, and without it somebody would be turned
        // away for a reason nothing on screen explained.
        using var admin = await AdminAsync();
        var email = $"{Unique("named")}@example.com";
        var invite = await CreateInviteAsync(admin, email);

        using var anyone = server.AnonymousClient();
        var preview = await anyone.GetFromJsonAsync<InvitePreview>(
            new Uri($"/api/invites/{invite.Token}/preview", UriKind.Relative));

        Assert.Equal(email, preview?.Email);
    }

    [Fact]
    public async Task An_invite_registers_exactly_one_account()
    {
        using var admin = await AdminAsync();
        var email = $"{Unique("once")}@example.com";
        var invite = await CreateInviteAsync(admin, email);
        await SetPublicSignupAsync(admin, false);

        try
        {
            using var client = server.Client();

            var first = await client.PostAsJsonAsync(
                new Uri("/api/auth/register", UriKind.Relative),
                new { username = "Invitee", email, password = FoxfireServerFixture.GoodPassword, inviteToken = invite.Token });

            Assert.True(first.IsSuccessStatusCode);

            var second = await client.PostAsJsonAsync(
                new Uri("/api/auth/register", UriKind.Relative),
                new { username = "Gatecrasher", email = $"{Unique("second")}@example.com", password = FoxfireServerFixture.GoodPassword, inviteToken = invite.Token });

            Assert.False(second.IsSuccessStatusCode);
        }
        finally
        {
            await SetPublicSignupAsync(admin, true);
        }
    }

    [Fact]
    public async Task An_invite_forwarded_to_somebody_else_opens_nothing()
    {
        using var admin = await AdminAsync();
        var invite = await CreateInviteAsync(admin, $"{Unique("intended")}@example.com");
        await SetPublicSignupAsync(admin, false);

        try
        {
            using var client = server.Client();

            var response = await client.PostAsJsonAsync(
                new Uri("/api/auth/register", UriKind.Relative),
                new
                {
                    username = "Forwarded",
                    email = $"{Unique("someone-else")}@example.com",
                    password = FoxfireServerFixture.GoodPassword,
                    inviteToken = invite.Token
                });

            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        finally
        {
            await SetPublicSignupAsync(admin, true);
        }
    }

    [Fact]
    public async Task With_signup_shut_an_invite_is_required()
    {
        using var admin = await AdminAsync();
        await SetPublicSignupAsync(admin, false);

        try
        {
            using var client = server.Client();

            var response = await client.PostAsJsonAsync(
                new Uri("/api/auth/register", UriKind.Relative),
                new { username = "Stranger", email = $"{Unique("stranger")}@example.com", password = FoxfireServerFixture.GoodPassword });

            var error = await response.Content.ReadFromJsonAsync<ApiError>();

            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.Equal("invite_required", error?.Error);
        }
        finally
        {
            await SetPublicSignupAsync(admin, true);
        }
    }

    [Fact]
    public async Task The_configured_admin_can_always_register_even_with_signup_shut()
    {
        // So a host can never lock themselves out of their own server.
        using var admin = await AdminAsync();
        await SetPublicSignupAsync(admin, false);

        try
        {
            using var client = server.AnonymousClient();
            var version = await client.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative));

            // Already registered by this point, so the observable guarantee here
            // is that the policy is public and the admin path does not depend on it.
            Assert.False(version?.PublicSignup);
        }
        finally
        {
            await SetPublicSignupAsync(admin, true);
        }
    }

    [Fact]
    public async Task A_forged_token_is_refused_the_same_way_an_unknown_one_is()
    {
        using var anyone = server.AnonymousClient();

        var forged = await anyone.GetFromJsonAsync<InvitePreview>(
            new Uri("/api/invites/AAAABBBBCCCCDDDD.EEEEFFFFGGGGHHHH/preview", UriKind.Relative));

        Assert.False(forged?.Usable);
        Assert.Null(forged?.Email);
    }

    [Fact]
    public async Task A_withdrawn_invite_says_so_rather_than_pretending_it_never_existed()
    {
        using var admin = await AdminAsync();
        var invite = await CreateInviteAsync(admin, $"{Unique("withdrawn")}@example.com");

        var revoked = await admin.DeleteAsync(new Uri($"/api/admin/invites/{invite.Id}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NoContent, revoked.StatusCode);

        using var anyone = server.AnonymousClient();
        var preview = await anyone.GetFromJsonAsync<InvitePreview>(
            new Uri($"/api/invites/{invite.Token}/preview", UriKind.Relative));

        Assert.False(preview?.Usable);
        Assert.Contains("withdrawn", preview?.Message ?? "", StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task An_invite_link_opens_the_web_client()
    {
        // The link is a page of the web client now, which reads the preview and
        // offers the sign-up form. The token is two halves joined by a dot, so
        // this is also the test that the fallback does not mistake it for a
        // file name and answer 404.
        using var admin = await AdminAsync();
        var invite = await CreateInviteAsync(admin, $"{Unique("landing")}@example.com");
        Assert.Contains('.', invite.Token);

        using var browser = server.AnonymousClient();
        var page = await browser.GetAsync(new Uri($"/invite/{invite.Token}", UriKind.Relative));
        var html = await page.Content.ReadAsStringAsync();

        page.EnsureSuccessStatusCode();
        Assert.Contains("text/html", page.Content.Headers.ContentType?.ToString() ?? "", StringComparison.Ordinal);
        Assert.Contains(FoxfireServerFixture.WebIndexMarker, html, StringComparison.Ordinal);
    }
}

/// <summary>
/// Who may do what.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class AuthorizationTests(FoxfireServerFixture server)
{
    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    [Fact]
    public async Task An_ordinary_member_cannot_reach_the_admin_routes()
    {
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Nosy", $"{Unique("nosy")}@example.com");
        FoxfireServerFixture.Authenticated(client, session);

        var invites = await client.GetAsync(new Uri("/api/admin/invites/", UriKind.Relative));
        var settings = await client.GetAsync(new Uri("/api/admin/settings/", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Forbidden, invites.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, settings.StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_cannot_reach_the_admin_routes()
    {
        using var client = server.Client();

        var response = await client.GetAsync(new Uri("/api/admin/invites/", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Riot_accounts_need_a_token()
    {
        using var client = server.Client();

        var response = await client.GetAsync(new Uri("/api/riot-accounts/", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

/// <summary>
/// Linking a League account, as far as a fake Riot key allows.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class RiotLinkTests(FoxfireServerFixture server)
{
    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    [Fact]
    public async Task Desktop_0_14s_list_of_every_account_still_answers_and_says_it_is_deprecated()
    {
        // Every account on the server in one answer, which nothing from Server
        // 0.4.0 on asks for — but Desktop 0.14 reads nothing else, and it is on
        // the allow list. Delete this test with the route.
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Looker", $"{Unique("look")}@example.com");
        FoxfireServerFixture.Authenticated(client, session);

        var response = await client.GetAsync(new Uri("/api/riot-accounts/", UriKind.Relative));

        response.EnsureSuccessStatusCode();

        // RFC 9745: the date it was deprecated, as "@" and Unix seconds.
        Assert.True(response.Headers.TryGetValues("Deprecation", out var deprecation));
        Assert.Equal(
            $"@{WholeServerAccountList.DeprecatedSince.ToUnixTimeSeconds()}",
            Assert.Single(deprecation));
    }

    [Fact]
    public async Task Only_the_deprecated_list_says_it_is_deprecated()
    {
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Current", $"{Unique("current")}@example.com");
        FoxfireServerFixture.Authenticated(client, session);

        var response = await client.GetAsync(new Uri("/api/riot-accounts/mine", UriKind.Relative));

        response.EnsureSuccessStatusCode();
        Assert.False(response.Headers.Contains("Deprecation"));
    }

    [Fact]
    public async Task A_riot_id_that_is_not_one_is_refused_before_riot_is_asked()
    {
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Mistyper", $"{Unique("mistype")}@example.com");
        FoxfireServerFixture.Authenticated(client, session);

        var response = await client.PostAsJsonAsync(
            new Uri("/api/riot-accounts/", UriKind.Relative),
            new { gameName = "", tagLine = "" });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("invalid_riot_id", error?.Error);
    }

    [Fact]
    public async Task A_dead_riot_key_is_reported_as_the_host_problem_it_is()
    {
        // The fixture's key is not real, so this is the degraded path: nothing
        // the person did is wrong and there is nothing they can do about it.
        using var client = server.Client();
        var session = await server.RegisterAsync(client, "Linker", $"{Unique("link")}@example.com");
        FoxfireServerFixture.Authenticated(client, session);

        var response = await client.PostAsJsonAsync(
            new Uri("/api/riot-accounts/", UriKind.Relative),
            new { gameName = "Faker", tagLine = "KR" });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("riot_key_rejected", error?.Error);
        Assert.Contains("administrator", error?.Message ?? "", StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>
/// The switches an admin can change while the server runs.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class AdminSettingsTests(FoxfireServerFixture server)
{
    private async Task<HttpClient> AdminAsync() => (await server.AdminAsync()).Client;

    [Fact]
    public async Task Public_signup_is_on_by_default()
    {
        using var admin = await AdminAsync();

        var settings = await admin.GetFromJsonAsync<ServerSettings>(new Uri("/api/admin/settings/", UriKind.Relative));

        Assert.True(settings?.PublicSignup);
        Assert.Equal(200, settings?.BackfillTarget);
    }

    [Fact]
    public async Task Closing_signup_shows_up_on_the_public_handshake()
    {
        // Which is what lets the desktop draw the right form before anybody has
        // typed anything.
        using var admin = await AdminAsync();

        try
        {
            await admin.PatchAsJsonAsync(new Uri("/api/admin/settings/", UriKind.Relative), new { publicSignup = false });

            using var anyone = server.AnonymousClient();
            var version = await anyone.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative));

            Assert.False(version?.PublicSignup);
        }
        finally
        {
            await admin.PatchAsJsonAsync(new Uri("/api/admin/settings/", UriKind.Relative), new { publicSignup = true });
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(5000)]
    public async Task An_impossible_backfill_target_is_refused(int target)
    {
        using var admin = await AdminAsync();

        var response = await admin.PatchAsJsonAsync(
            new Uri("/api/admin/settings/", UriKind.Relative),
            new { backfillTarget = target });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("invalid_backfill_target", error?.Error);
    }

    [Fact]
    public async Task A_refused_patch_changes_nothing_at_all()
    {
        // It used to change something. The endpoint stored the replay cap and
        // then looked at the backfill target, so a request carrying a good cap
        // and a bad target was refused with the cap already written — and the
        // answer said the request had failed.
        using var admin = await AdminAsync();

        var before = await admin.GetFromJsonAsync<ServerSettings>(
            new Uri("/api/admin/settings/", UriKind.Relative));

        var response = await admin.PatchAsJsonAsync(
            new Uri("/api/admin/settings/", UriKind.Relative),
            new { replayByteCap = 5_000_000_000L, backfillTarget = 5000 });

        var error = await response.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("invalid_backfill_target", error?.Error);

        var after = await admin.GetFromJsonAsync<ServerSettings>(
            new Uri("/api/admin/settings/", UriKind.Relative));

        Assert.Equal(before?.ReplayByteCap, after?.ReplayByteCap);
        Assert.Equal(before?.BackfillTarget, after?.BackfillTarget);
    }

    [Fact]
    public async Task A_sensible_backfill_target_sticks()
    {
        using var admin = await AdminAsync();

        try
        {
            var response = await admin.PatchAsJsonAsync(
                new Uri("/api/admin/settings/", UriKind.Relative),
                new { backfillTarget = 50 });

            var settings = await response.Content.ReadFromJsonAsync<ServerSettings>();
            Assert.Equal(50, settings?.BackfillTarget);
        }
        finally
        {
            await admin.PatchAsJsonAsync(new Uri("/api/admin/settings/", UriKind.Relative), new { backfillTarget = 200 });
        }
    }
}
