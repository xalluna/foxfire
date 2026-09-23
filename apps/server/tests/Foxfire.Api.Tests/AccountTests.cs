using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace Foxfire.Api.Tests;

/// <summary>
/// Looking after your own account: the password, the address you sign in with,
/// and the name beside your games.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class AccountTests(FoxfireServerFixture server)
{
    private const string NewPassword = "a-brand-new-password";

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    private static Uri Api(string path) => new(path, UriKind.Relative);

    /// <summary>
    /// A registered member, with a client already carrying their token.
    ///
    /// The name is made unique as well as the address. One database serves the
    /// whole assembly and a username is unique across a server, so a fixed one
    /// here is a registration that fails the moment another class picks the
    /// same word.
    /// </summary>
    private async Task<(HttpClient Client, Session Session, string Email)> MemberAsync(string name)
    {
        var email = $"{Unique(name.ToLowerInvariant())}@example.com";
        var client = server.Client();
        var session = await server.RegisterAsync(client, Named(name), email);

        return (FoxfireServerFixture.Authenticated(client, session), session, email);
    }

    /// <summary>That name, with enough of a suffix that nobody else has it.</summary>
    private static string Named(string name) => $"{name}{Guid.NewGuid():N}"[..Math.Min(name.Length + 8, 32)];

    private static Task<HttpResponseMessage> SignInAsync(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync(Api("/api/auth/login"), new { email, password });

    [Fact]
    public async Task Changing_your_password_keeps_this_device_and_cuts_every_other_one()
    {
        // The whole point of the answer carrying a session. Revoking everything
        // and handing back a fresh pair is what lets somebody change a password
        // that may have leaked without signing themselves out of the window they
        // are standing in front of.
        var (client, _, email) = await MemberAsync("Rotator");
        using var mine = client;

        using var other = server.Client();
        var elsewhere = (await (await SignInAsync(other, email, FoxfireServerFixture.GoodPassword))
            .Content.ReadFromJsonAsync<Session>())!;

        var changed = await mine.PostAsJsonAsync(
            Api("/api/auth/password"),
            new { currentPassword = FoxfireServerFixture.GoodPassword, newPassword = NewPassword });

        var replacement = (await changed.Content.ReadFromJsonAsync<Session>())!;

        var theirs = await other.PostAsJsonAsync(
            Api("/api/auth/refresh"), new { refreshToken = elsewhere.RefreshToken });

        // After the other device has been turned away — which is the moment the
        // replay detection used to cut this session too, because a token revoked
        // by a password change looked exactly like a stolen one being replayed.
        var still = await mine.PostAsJsonAsync(
            Api("/api/auth/refresh"), new { refreshToken = replacement.RefreshToken });

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, theirs.StatusCode);
        Assert.Equal(HttpStatusCode.OK, still.StatusCode);
    }

    [Fact]
    public async Task The_new_password_is_the_one_that_works()
    {
        var (client, _, email) = await MemberAsync("Changed");
        using var mine = client;

        await mine.PostAsJsonAsync(
            Api("/api/auth/password"),
            new { currentPassword = FoxfireServerFixture.GoodPassword, newPassword = NewPassword });

        using var fresh = server.Client();
        var old = await SignInAsync(fresh, email, FoxfireServerFixture.GoodPassword);
        var current = await SignInAsync(fresh, email, NewPassword);

        Assert.Equal(HttpStatusCode.Unauthorized, old.StatusCode);
        Assert.Equal(HttpStatusCode.OK, current.StatusCode);
    }

    [Fact]
    public async Task The_wrong_current_password_changes_nothing()
    {
        var (client, _, email) = await MemberAsync("Fumbler");
        using var mine = client;

        var response = await mine.PostAsJsonAsync(
            Api("/api/auth/password"),
            new { currentPassword = "not-my-password", newPassword = NewPassword });

        using var fresh = server.Client();
        var unchanged = await SignInAsync(fresh, email, FoxfireServerFixture.GoodPassword);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("wrong_password", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
        Assert.Equal(HttpStatusCode.OK, unchanged.StatusCode);
    }

    [Fact]
    public async Task A_new_password_shorter_than_the_rule_is_refused()
    {
        var (client, _, _) = await MemberAsync("Brief");
        using var mine = client;

        var response = await mine.PostAsJsonAsync(
            Api("/api/auth/password"),
            new { currentPassword = FoxfireServerFixture.GoodPassword, newPassword = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("weak_password", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task The_web_client_is_handed_its_new_session_as_a_cookie()
    {
        // The desktop keeps its own refresh token; a browser is given one it
        // cannot read. Both have to come out of a password change, or whichever
        // client did not get one is signed out a quarter of an hour later.
        using var web = server.WebClient();
        var email = $"{Unique("cookie")}@example.com";

        var registered = await web.PostAsJsonAsync(
            Api("/api/auth/register"),
            new { username = Named("Cookie"), email, password = FoxfireServerFixture.GoodPassword });

        var session = (await registered.Content.ReadFromJsonAsync<WebSession>())!;
        web.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);

        var changed = await web.PostAsJsonAsync(
            Api("/api/auth/password"),
            new { currentPassword = FoxfireServerFixture.GoodPassword, newPassword = NewPassword });

        // The container has the new cookie now, and the one it replaced was
        // revoked by the change — so a refresh that works proves it was given a
        // live one rather than left holding the old.
        var refreshed = await web.PostAsync(Api("/api/auth/refresh"), content: null);

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.True(changed.Headers.Contains("Set-Cookie"));
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
    }

    [Fact]
    public async Task Changing_your_email_moves_the_login()
    {
        var (client, _, email) = await MemberAsync("Mover");
        using var mine = client;
        var moved = $"{Unique("moved")}@example.com";

        var response = await mine.PatchAsJsonAsync(
            Api("/api/auth/email"),
            new { email = moved, currentPassword = FoxfireServerFixture.GoodPassword });

        var me = await response.Content.ReadFromJsonAsync<SessionUser>();

        using var fresh = server.Client();
        var old = await SignInAsync(fresh, email, FoxfireServerFixture.GoodPassword);
        var current = await SignInAsync(fresh, moved, FoxfireServerFixture.GoodPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(moved, me?.Email);
        Assert.Equal(HttpStatusCode.Unauthorized, old.StatusCode);
        Assert.Equal(HttpStatusCode.OK, current.StatusCode);
    }

    [Fact]
    public async Task Changing_your_email_needs_your_password()
    {
        var (client, _, _) = await MemberAsync("Unproven");
        using var mine = client;

        var response = await mine.PatchAsJsonAsync(
            Api("/api/auth/email"),
            new { email = $"{Unique("nope")}@example.com", currentPassword = "not-my-password" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("wrong_password", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task An_address_somebody_else_signs_in_with_is_refused()
    {
        var (client, _, _) = await MemberAsync("Copycat");
        using var mine = client;

        var (other, _, taken) = await MemberAsync("Original");
        other.Dispose();

        var response = await mine.PatchAsJsonAsync(
            Api("/api/auth/email"),
            new { email = taken, currentPassword = FoxfireServerFixture.GoodPassword });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("email_taken", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task The_configured_admin_cannot_move_off_that_address()
    {
        // Registering with Admin__Email grants the Admin role, even on a server
        // with signup shut, and the address is re-granted it on every boot. An
        // owner who moved their account off it would leave that claim lying
        // around for whoever registered it next.
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;

        var response = await theirs.PatchAsJsonAsync(
            Api("/api/auth/email"),
            new
            {
                email = $"{Unique("elsewhere")}@example.com",
                currentPassword = FoxfireServerFixture.GoodPassword
            });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("admin_email_pinned", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task Nobody_else_can_take_the_admin_address()
    {
        var (client, _, _) = await MemberAsync("Pretender");
        using var mine = client;

        var response = await mine.PatchAsJsonAsync(
            Api("/api/auth/email"),
            new { email = FoxfireServerFixture.AdminEmail, currentPassword = FoxfireServerFixture.GoodPassword });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("admin_email_reserved", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task Renaming_yourself_needs_no_password_and_takes_effect()
    {
        var (client, _, _) = await MemberAsync("Before");
        using var mine = client;
        var renamed = Named("After");

        var response = await mine.PatchAsJsonAsync(Api("/api/auth/username"), new { username = renamed });
        var me = await response.Content.ReadFromJsonAsync<SessionUser>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(renamed, me?.Username);
    }

    [Fact]
    public async Task A_name_somebody_else_goes_by_is_refused()
    {
        var (client, _, _) = await MemberAsync("Second");
        using var mine = client;
        var taken = Named("Taken");

        using var first = server.Client();
        await server.RegisterAsync(first, taken, $"{Unique("first")}@example.com");

        var response = await mine.PatchAsJsonAsync(Api("/api/auth/username"), new { username = taken });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("username_taken", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task A_name_of_the_wrong_length_is_refused_before_anything_else()
    {
        var (client, _, _) = await MemberAsync("Sized");
        using var mine = client;

        var response = await mine.PatchAsJsonAsync(Api("/api/auth/username"), new { username = "ab" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_username", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task None_of_this_is_open_to_somebody_signed_out()
    {
        using var anonymous = server.Client();

        var password = await anonymous.PostAsJsonAsync(
            Api("/api/auth/password"), new { currentPassword = "x", newPassword = NewPassword });
        var email = await anonymous.PatchAsJsonAsync(
            Api("/api/auth/email"), new { email = "someone@example.com", currentPassword = "x" });
        var username = await anonymous.PatchAsJsonAsync(Api("/api/auth/username"), new { username = "Nobody" });

        Assert.Equal(HttpStatusCode.Unauthorized, password.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, email.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, username.StatusCode);
    }
}
