using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// A server with no email provider behaves as it always did: links an admin
/// copies, an email change that happens at once, and not one row in the outbox.
/// The fixture's own host is such a server.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public sealed class EmailOffTests(FoxfireServerFixture server)
{
    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..Math.Min(32, prefix.Length + 12)];

    private static Uri Api(string path) => new(path, UriKind.Relative);

    [Fact]
    public async Task The_handshake_says_there_is_no_mail()
    {
        using var client = server.Client();

        var version = await client.GetFromJsonAsync<JsonElement>(Api("/version"));

        Assert.False(version.GetProperty("email").GetBoolean());
    }

    [Fact]
    public async Task Forgot_password_says_to_ask_an_admin()
    {
        using var client = server.Client();

        var response = await client.PostAsJsonAsync(Api("/api/password-resets/request"), new { email = "anybody@example.com" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("email_unavailable", (await response.Content.ReadFromJsonAsync<ApiError>())!.Error);
    }

    [Fact]
    public async Task An_invite_with_an_address_queues_nothing()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        var address = $"{Unique("offinvite")}@example.com";
        var response = await admin.PostAsJsonAsync(Api("/api/admin/invites/"), new { email = address });
        response.EnsureSuccessStatusCode();

        var invite = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, invite.GetProperty("mail").ValueKind);
        Assert.False(invite.GetProperty("canEmail").GetBoolean());

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        Assert.False(await db.EmailMessages.AnyAsync(m => m.Recipient == address));
    }

    [Fact]
    public async Task A_reset_link_says_it_was_not_emailed_because_there_is_no_mail()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        using var member = server.Client();
        var name = Unique("offreset");
        var session = await server.RegisterAsync(member, name, $"{name}@example.com");

        var response = await admin.PostAsync(Api($"/api/admin/users/{session.User.Id}/password-reset"), null);
        response.EnsureSuccessStatusCode();

        var reset = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("email_off", reset.GetProperty("notEmailed").GetString());
        Assert.Contains("/reset-password/", reset.GetProperty("link").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Changing_your_email_happens_at_once()
    {
        using var client = server.Client();
        var name = Unique("offmove");
        FoxfireServerFixture.Authenticated(client, await server.RegisterAsync(client, name, $"{name}@example.com"));
        var moved = $"{name}-new@example.com";

        var response = await client.PatchAsJsonAsync(
            Api("/api/auth/email"), new { email = moved, currentPassword = FoxfireServerFixture.GoodPassword });
        response.EnsureSuccessStatusCode();

        var me = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(moved, me.GetProperty("email").GetString());
        Assert.Equal(JsonValueKind.Null, me.GetProperty("pendingEmail").ValueKind);
    }

    [Fact]
    public async Task Your_email_says_mail_is_off()
    {
        using var client = server.Client();
        var name = Unique("offmine");
        FoxfireServerFixture.Authenticated(client, await server.RegisterAsync(client, name, $"{name}@example.com"));

        var mine = await client.GetFromJsonAsync<JsonElement>(Api("/api/account/email"));

        Assert.False(mine.GetProperty("mailEnabled").GetBoolean());
        Assert.False(mine.GetProperty("emailConfirmed").GetBoolean());

        var resend = await client.PostAsync(Api("/api/account/email/confirmation"), null);
        Assert.Equal("email_unavailable", (await resend.Content.ReadFromJsonAsync<ApiError>())!.Error);
    }

    [Fact]
    public async Task The_email_page_says_nothing_is_configured()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        var overview = await admin.GetFromJsonAsync<JsonElement>(Api("/api/admin/email/"));

        Assert.False(overview.GetProperty("configured").GetBoolean());
        Assert.Equal(JsonValueKind.Null, overview.GetProperty("today").ValueKind);
    }

    [Fact]
    public async Task The_email_page_is_for_head_admins_only()
    {
        var (plain, _) = await server.PlainAdminAsync("MailPlain");
        using var _plain = plain;

        foreach (var route in new[] { "/api/admin/email/", "/api/admin/email/messages", "/api/admin/email/suppressions", "/api/admin/insights/email" })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await plain.GetAsync(Api(route))).StatusCode);
        }

        var test = await plain.PostAsJsonAsync(Api("/api/admin/email/test"), new { to = "x@example.com" });
        Assert.Equal(HttpStatusCode.Forbidden, test.StatusCode);
    }

    [Fact]
    public async Task A_webhook_for_a_server_with_no_mail_is_not_found()
    {
        using var client = server.AnonymousClient();

        var response = await client.SendAsync(FakeResend.Webhook("email.delivered", "re_nothing"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
