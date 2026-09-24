using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Common;

namespace Foxfire.Api.Tests;

/// <summary>
/// Reset links: the way back into an account on a server that cannot send mail.
///
/// An admin makes one, copies it, and sends it however their community talks.
/// The link is short-lived and single use, there is never more than one live per
/// account, and using it ends every session that account had.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class PasswordResetTests(FoxfireServerFixture server)
{
    private const string NewPassword = "a-freshly-chosen-password";

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    private static Uri Api(string path) => new(path, UriKind.Relative);

    private static Uri ResetFor(Guid userId) => Api($"/api/admin/users/{userId}/password-reset");

    /// <summary>
    /// A registered member. Name and address both unique: one database serves
    /// the whole assembly, and a username is unique across a server.
    /// </summary>
    private async Task<(HttpClient Client, Session Session, string Email)> MemberAsync(string name)
    {
        var email = $"{Unique(name.ToLowerInvariant())}@example.com";
        var client = server.Client();
        var session = await server.RegisterAsync(
            client, $"{name}{Guid.NewGuid():N}"[..Math.Min(name.Length + 8, 32)], email);

        return (client, session, email);
    }

    private static async Task<ResetInfo> CreateAsync(HttpClient admin, Guid userId)
    {
        var response = await admin.PostAsync(ResetFor(userId), content: null);
        response.EnsureSuccessStatusCode();

        return (await response.Content.ReadFromJsonAsync<ResetInfo>())!;
    }

    private async Task<PasswordResetPreview> PreviewAsync(string token)
    {
        using var anyone = server.AnonymousClient();
        return (await anyone.GetFromJsonAsync<PasswordResetPreview>(
            Api($"/api/password-resets/{token}/preview")))!;
    }

    private async Task<HttpResponseMessage> RedeemAsync(string token, string password = NewPassword)
    {
        using var anyone = server.AnonymousClient();
        return await anyone.PostAsJsonAsync(
            Api($"/api/password-resets/{token}/redeem"), new { newPassword = password });
    }

    [Fact]
    public async Task A_link_reads_as_a_page_of_this_server_and_shows_up_on_the_member()
    {
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, email) = await MemberAsync("Forgetful");
        client.Dispose();

        var reset = await CreateAsync(admin, member.User.Id);
        var users = (await admin.GetFromJsonAsync<Page<AdminUser>>(
            Api($"/api/admin/users/?q={Uri.EscapeDataString(member.User.Email)}")))!;
        var listed = users.Items.Single(u => u.Id == member.User.Id);

        Assert.StartsWith("https://test.example.com/reset-password/", reset.Link, StringComparison.Ordinal);
        Assert.Equal(member.User.Id, reset.UserId);

        // The list carries the link so an admin can copy it again tomorrow
        // rather than having to replace it.
        Assert.Equal(reset.Link, listed.PasswordReset?.Link);

        var preview = await PreviewAsync(reset.Token);

        Assert.True(preview.Usable);
        Assert.Equal(FoxfireServerFixture.ServerName, preview.ServerName);
        Assert.Equal(member.User.Username, preview.Username);
        Assert.Equal(email, preview.Email);
    }

    [Fact]
    public async Task Making_one_changes_nothing_until_it_is_used()
    {
        // The old password keeps working, so an admin who makes a link for
        // somebody who then remembers their password has locked nobody out.
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, email) = await MemberAsync("Patient");
        using var mine = client;

        await CreateAsync(admin, member.User.Id);

        var login = await mine.PostAsJsonAsync(
            Api("/api/auth/login"), new { email, password = FoxfireServerFixture.GoodPassword });

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Using_one_sets_the_password_signs_them_in_and_ends_every_session()
    {
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, email) = await MemberAsync("Returning");
        using var mine = client;

        var reset = await CreateAsync(admin, member.User.Id);
        var redeemed = await RedeemAsync(reset.Token);
        var session = await redeemed.Content.ReadFromJsonAsync<Session>();

        // The session they had before is gone, the new password is the one that
        // works, and the answer signed them in on the page they used.
        var before = await mine.PostAsJsonAsync(
            Api("/api/auth/refresh"), new { refreshToken = member.RefreshToken });
        var old = await mine.PostAsJsonAsync(
            Api("/api/auth/login"), new { email, password = FoxfireServerFixture.GoodPassword });
        var now = await mine.PostAsJsonAsync(
            Api("/api/auth/login"), new { email, password = NewPassword });

        Assert.Equal(HttpStatusCode.OK, redeemed.StatusCode);
        Assert.Equal(member.User.Id, session?.User.Id);
        Assert.False(string.IsNullOrWhiteSpace(session?.AccessToken));
        Assert.Equal(HttpStatusCode.Unauthorized, before.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, old.StatusCode);
        Assert.Equal(HttpStatusCode.OK, now.StatusCode);
    }

    [Fact]
    public async Task A_link_only_works_once()
    {
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, _) = await MemberAsync("Twice");
        client.Dispose();

        var reset = await CreateAsync(admin, member.User.Id);
        await RedeemAsync(reset.Token);

        var again = await RedeemAsync(reset.Token, "another-password-entirely");
        var preview = await PreviewAsync(reset.Token);

        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.False(preview.Usable);
        Assert.Contains("already been used", preview.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_newer_link_replaces_the_one_before_it()
    {
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, _) = await MemberAsync("Replaced");
        client.Dispose();

        var first = await CreateAsync(admin, member.User.Id);
        var second = await CreateAsync(admin, member.User.Id);

        var stale = await PreviewAsync(first.Token);
        var current = await PreviewAsync(second.Token);

        Assert.NotEqual(first.Link, second.Link);
        Assert.False(stale.Usable);
        Assert.True(current.Usable);
    }

    [Fact]
    public async Task Withdrawing_one_puts_it_out_of_use()
    {
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, _) = await MemberAsync("Withdrawn");
        client.Dispose();

        var reset = await CreateAsync(admin, member.User.Id);
        var withdrawn = await admin.DeleteAsync(ResetFor(member.User.Id));

        var preview = await PreviewAsync(reset.Token);
        var users = (await admin.GetFromJsonAsync<Page<AdminUser>>(
            Api($"/api/admin/users/?q={Uri.EscapeDataString(member.User.Email)}")))!;

        Assert.Equal(HttpStatusCode.NoContent, withdrawn.StatusCode);
        Assert.False(preview.Usable);
        Assert.Contains("withdrawn", preview.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Null(users.Items.Single(u => u.Id == member.User.Id).PasswordReset);
    }

    [Fact]
    public async Task Changing_the_password_yourself_puts_an_outstanding_link_out_of_date()
    {
        // The link is pinned to the account's security stamp, and Identity
        // rotates that on every password change. Somebody who remembers their
        // password before the link arrives has turned it off by using it.
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, _) = await MemberAsync("Remembered");
        using var mine = FoxfireServerFixture.Authenticated(client, member);

        var reset = await CreateAsync(admin, member.User.Id);

        await mine.PostAsJsonAsync(
            Api("/api/auth/password"),
            new { currentPassword = FoxfireServerFixture.GoodPassword, newPassword = "yet-another-password" });

        var preview = await PreviewAsync(reset.Token);

        Assert.False(preview.Usable);
    }

    [Fact]
    public async Task A_password_the_rules_refuse_does_not_spend_the_link()
    {
        // Spending the link and setting the password stand or fall together, so
        // a typo short of twelve characters does not burn somebody's only way in.
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, _) = await MemberAsync("Typo");
        client.Dispose();

        var reset = await CreateAsync(admin, member.User.Id);

        var refused = await RedeemAsync(reset.Token, "short");
        var retry = await RedeemAsync(reset.Token);

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal("weak_password", (await refused.Content.ReadFromJsonAsync<ApiError>())?.Error);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
    }

    [Fact]
    public async Task A_disabled_account_is_refused_a_link_rather_than_given_a_dead_one()
    {
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, _) = await MemberAsync("Barred");
        client.Dispose();

        await admin.PatchAsJsonAsync(
            Api($"/api/admin/users/{member.User.Id}"), new { isDisabled = true });

        var response = await admin.PostAsync(ResetFor(member.User.Id), content: null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("account_disabled", (await response.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task A_forged_or_expired_token_says_only_that_it_is_no_good()
    {
        var forged = await PreviewAsync("not.atoken");
        var redeemed = await RedeemAsync("not.atoken");

        Assert.False(forged.Usable);
        Assert.Null(forged.Username);
        Assert.Null(forged.Email);
        Assert.Equal(HttpStatusCode.BadRequest, redeemed.StatusCode);
        Assert.Equal("reset_not_usable", (await redeemed.Content.ReadFromJsonAsync<ApiError>())?.Error);
    }

    [Fact]
    public async Task Deleting_somebody_who_has_a_link_outstanding_works()
    {
        // Two foreign keys into Users from one table, so only one of them can
        // cascade: the reset goes with the account it is for, and the admin who
        // made it is cleared by hand before they can be deleted themselves.
        var (admin, _) = await server.AdminAsync();
        using var theirs = admin;
        var (client, member, _) = await MemberAsync("Departing");
        client.Dispose();

        await CreateAsync(admin, member.User.Id);
        var deleted = await admin.DeleteAsync(Api($"/api/admin/users/{member.User.Id}"));

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
    }

    [Fact]
    public async Task An_ordinary_member_cannot_make_one()
    {
        var (client, member, _) = await MemberAsync("Meddling");
        using var mine = FoxfireServerFixture.Authenticated(client, member);

        var response = await mine.PostAsync(ResetFor(member.User.Id), content: null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private sealed record ResetInfo(
        Guid Id,
        Guid UserId,
        string Link,
        DateTimeOffset CreatedAt,
        DateTimeOffset ExpiresAt)
    {
        /// <summary>The token out of the link, which is what a client actually sends.</summary>
        public string Token => Link[(Link.LastIndexOf('/') + 1)..];
    }

    private sealed record PasswordResetPreview(
        bool Usable,
        string ServerName,
        string? Username,
        string? Email,
        string Message);

    private sealed record AdminUser(
        Guid Id,
        string Username,
        string Email,
        bool IsAdmin,
        bool IsDisabled,
        DateTimeOffset CreatedAt,
        int LinkedRiotAccounts,
        int ActiveSessions,
        ResetInfo? PasswordReset);
}
