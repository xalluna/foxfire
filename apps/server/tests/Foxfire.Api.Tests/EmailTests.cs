using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The server's mail, end to end, against a Resend that is a stub handler and
/// nothing else: what is queued, what reaches the provider and with which link,
/// what the webhooks move it to, and what the admin screens then say.
///
/// A host per test — xUnit makes the class once per test — so a latch or a
/// signal in one dispatcher cannot leak into the next test.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public sealed class EmailTests(FoxfireServerFixture server) : IAsyncLifetime
{
    private readonly FakeResend _resend = new();
    private WebApplicationFactory<Program>? _host;

    private WebApplicationFactory<Program> Host => _host!;

    public Task InitializeAsync()
    {
        _host = _resend.Host(server.Factory);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        if (_host is not null) await _host.DisposeAsync();
    }

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..Math.Min(30, prefix.Length + 12)];

    private static Uri Api(string path) => new(path, UriKind.Relative);

    private HttpClient Client()
    {
        var client = Host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        return client;
    }

    private async Task<HttpClient> HeadAdminAsync()
    {
        var (fixtureClient, session) = await server.AdminAsync();
        fixtureClient.Dispose();
        return FoxfireServerFixture.Authenticated(Client(), session);
    }

    /// <summary>A member registered through this host, confirmed or not.</summary>
    private async Task<(HttpClient Client, Session Session, string Email)> MemberAsync(string prefix, bool confirmed)
    {
        var name = Unique(prefix);
        var email = $"{name.ToLowerInvariant()}@example.com";
        var client = Client();
        var session = await server.RegisterAsync(client, name, email);

        if (confirmed)
        {
            await using var scope = Host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            await db.Users.Where(u => u.Id == session.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, true));
        }

        return (FoxfireServerFixture.Authenticated(client, session), session, email);
    }

    private Task<EmailMessage> SentAsync(string recipient, string kind) =>
        FakeResend.EventuallyAsync(Host.Services, recipient, m => m.Kind == kind && m.SentAt is not null);

    private async Task<HttpResponseMessage> WebhookAsync(HttpRequestMessage request)
    {
        using var client = Host.CreateClient();
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task An_invite_with_an_address_is_emailed_with_the_link_the_admin_sees()
    {
        using var admin = await HeadAdminAsync();
        var address = $"{Unique("invitee")}@example.com";

        var response = await admin.PostAsJsonAsync(Api("/api/admin/invites/"), new { email = address });
        response.EnsureSuccessStatusCode();
        var invite = await response.Content.ReadFromJsonAsync<JsonElement>();

        var message = await SentAsync(address, EmailKinds.Invite);
        var sent = Assert.Single(_resend.To(address));

        Assert.Equal(invite.GetProperty("link").GetString(), sent.Link);
        Assert.Equal(message.Id.ToString(), sent.IdempotencyKey);
        Assert.Equal("Bearer re_test_key_not_real", sent.Authorization);
        Assert.StartsWith("Foxfire-Server", sent.UserAgent, StringComparison.Ordinal);
        Assert.Contains(FakeResend.FromAddress, sent.From, StringComparison.Ordinal);
        Assert.Equal(EmailKinds.Invite, sent.Kind);
        Assert.Equal(sent.ProviderId, message.ProviderMessageId);

        // The invite list says so, and there is nothing to email again.
        var open = await admin.GetFromJsonAsync<JsonElement>(Api("/api/admin/invites/"));
        var row = open.EnumerateArray().Single(i => i.GetProperty("email").GetString() == address);
        Assert.Equal("sent", row.GetProperty("mail").GetProperty("status").GetString());
        Assert.False(row.GetProperty("canEmail").GetBoolean());

        // Asking again for the same address hands back the same invite, and
        // sends nothing more.
        var again = await admin.PostAsJsonAsync(Api("/api/admin/invites/"), new { email = address });
        again.EnsureSuccessStatusCode();
        Assert.Single(await FakeResend.MessagesToAsync(Host.Services, address));
    }

    [Fact]
    public async Task Webhooks_move_a_message_forward_and_only_forward()
    {
        using var admin = await HeadAdminAsync();
        var address = $"{Unique("hooked")}@example.com";

        (await admin.PostAsJsonAsync(Api("/api/admin/invites/"), new { email = address })).EnsureSuccessStatusCode();
        var message = await SentAsync(address, EmailKinds.Invite);

        Assert.Equal(
            HttpStatusCode.NoContent,
            (await WebhookAsync(FakeResend.Webhook("email.delivered", message.ProviderMessageId!))).StatusCode);

        var delivered = await FakeResend.EventuallyAsync(Host.Services, address, m => m.Status == EmailStatuses.Delivered);
        Assert.NotNull(delivered.DeliveredAt);

        // A late "sent" changes nothing; a delivery is not undone.
        await WebhookAsync(FakeResend.Webhook("email.sent", message.ProviderMessageId!));
        Assert.Equal(EmailStatuses.Delivered, (await FakeResend.MessagesToAsync(Host.Services, address)).Single().Status);
    }

    [Fact]
    public async Task A_webhook_is_believed_only_with_a_good_recent_signature()
    {
        var forged = FakeResend.SignedWebhook(
            """{"type":"email.delivered","data":{"email_id":"re_x"}}""",
            DateTimeOffset.UtcNow,
            "whsec_" + Convert.ToBase64String(new byte[32]));
        Assert.Equal(HttpStatusCode.Unauthorized, (await WebhookAsync(forged)).StatusCode);

        var stale = FakeResend.Webhook("email.delivered", "re_x", at: DateTimeOffset.UtcNow.AddMinutes(-10));
        Assert.Equal(HttpStatusCode.Unauthorized, (await WebhookAsync(stale)).StatusCode);

        var unsigned = new HttpRequestMessage(HttpMethod.Post, Api("/api/email/webhooks/resend"))
        {
            Content = JsonContent.Create(new { type = "email.delivered" })
        };
        Assert.Equal(HttpStatusCode.Unauthorized, (await WebhookAsync(unsigned)).StatusCode);

        // About mail this server has no record of — the account may send for
        // other things too.
        var unknown = FakeResend.Webhook("email.delivered", $"re_{Guid.NewGuid():N}");
        Assert.Equal(HttpStatusCode.NoContent, (await WebhookAsync(unknown)).StatusCode);
    }

    [Fact]
    public async Task A_hard_bounce_stops_mail_to_the_address_until_a_head_admin_clears_it()
    {
        using var admin = await HeadAdminAsync();
        var address = $"{Unique("bouncer")}@example.com";

        var created = await (await admin.PostAsJsonAsync(Api("/api/admin/invites/"), new { email = address }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var inviteId = created.GetProperty("id").GetGuid();
        var message = await SentAsync(address, EmailKinds.Invite);

        await WebhookAsync(FakeResend.Webhook(
            "email.bounced",
            message.ProviderMessageId!,
            """ "bounce":{"type":"Permanent","subType":"General","message":"No such user"} """));

        var bounced = await FakeResend.EventuallyAsync(Host.Services, address, m => m.Status == EmailStatuses.Bounced);
        Assert.Equal("hard_bounce", bounced.Reason);

        // Suppressed: not offered again, and refused if asked.
        var row = (await admin.GetFromJsonAsync<JsonElement>(Api("/api/admin/invites/")))
            .EnumerateArray().Single(i => i.GetProperty("id").GetGuid() == inviteId);
        Assert.False(row.GetProperty("canEmail").GetBoolean());

        var refused = await admin.PostAsync(Api($"/api/admin/invites/{inviteId}/email"), null);
        Assert.Equal("email_suppressed", (await refused.Content.ReadFromJsonAsync<ApiError>())!.Error);

        // A head admin clears it, and the invite can go again.
        var suppressions = await admin.GetFromJsonAsync<JsonElement>(Api($"/api/admin/email/suppressions?q={address}"));
        var suppression = Assert.Single(suppressions.GetProperty("items").EnumerateArray());
        Assert.Equal("hard_bounce", suppression.GetProperty("reason").GetString());

        var cleared = await admin.DeleteAsync(Api($"/api/admin/email/suppressions/{suppression.GetProperty("id").GetGuid()}"));
        Assert.Equal(HttpStatusCode.NoContent, cleared.StatusCode);

        var resent = await admin.PostAsync(Api($"/api/admin/invites/{inviteId}/email"), null);
        resent.EnsureSuccessStatusCode();

        await FakeResend.EventuallyAsync(Host.Services, address, m => m.Status == EmailStatuses.Sent);
        Assert.Equal(2, _resend.To(address).Count);
    }

    [Fact]
    public async Task A_soft_bounce_can_be_emailed_again_but_nothing_goes_twice_at_once()
    {
        using var admin = await HeadAdminAsync();
        var address = $"{Unique("softie")}@example.com";

        var created = await (await admin.PostAsJsonAsync(Api("/api/admin/invites/"), new { email = address }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var inviteId = created.GetProperty("id").GetGuid();
        var message = await SentAsync(address, EmailKinds.Invite);

        var inProgress = await admin.PostAsync(Api($"/api/admin/invites/{inviteId}/email"), null);
        Assert.Equal("invite_email_in_progress", (await inProgress.Content.ReadFromJsonAsync<ApiError>())!.Error);

        await WebhookAsync(FakeResend.Webhook(
            "email.bounced", message.ProviderMessageId!, """ "bounce":{"type":"Transient","subType":"MailboxFull"} """));
        await FakeResend.EventuallyAsync(Host.Services, address, m => m.Status == EmailStatuses.Bounced);

        (await admin.PostAsync(Api($"/api/admin/invites/{inviteId}/email"), null)).EnsureSuccessStatusCode();
        await FakeResend.EventuallyAsync(Host.Services, address, m => m.Status == EmailStatuses.Sent);
    }

    [Fact]
    public async Task Registering_through_an_emailed_invite_confirms_the_address()
    {
        using var admin = await HeadAdminAsync();
        var name = Unique("invited");
        var address = $"{name.ToLowerInvariant()}@example.com";

        (await admin.PostAsJsonAsync(Api("/api/admin/invites/"), new { email = address })).EnsureSuccessStatusCode();
        await SentAsync(address, EmailKinds.Invite);

        var token = Assert.Single(_resend.To(address)).Token;
        using var client = Client();
        var session = await server.RegisterAsync(client, name, address, token);

        Assert.True(session.User.EmailConfirmed);
        Assert.DoesNotContain(await FakeResend.MessagesToAsync(Host.Services, address), m => m.Kind == EmailKinds.Verification);
    }

    [Fact]
    public async Task A_new_account_is_sent_a_link_that_confirms_its_address()
    {
        var (client, session, address) = await MemberAsync("newbie", confirmed: false);
        using var _client = client;

        Assert.False(session.User.EmailConfirmed);

        await SentAsync(address, EmailKinds.Verification);
        var token = Assert.Single(_resend.To(address)).Token;

        var confirmed = await client.PostAsJsonAsync(Api("/api/email-verifications/confirm"), new { token });
        confirmed.EnsureSuccessStatusCode();
        Assert.Equal("verify", (await confirmed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("purpose").GetString());

        var me = await client.GetFromJsonAsync<JsonElement>(Api("/api/auth/me"));
        Assert.True(me.GetProperty("emailConfirmed").GetBoolean());

        // A second click is told why nothing happened.
        var again = await client.PostAsJsonAsync(Api("/api/email-verifications/confirm"), new { token });
        Assert.Equal("confirmation_not_usable", (await again.Content.ReadFromJsonAsync<ApiError>())!.Error);
    }

    [Fact]
    public async Task Forgot_password_sends_one_link_while_it_is_live()
    {
        var (client, _, address) = await MemberAsync("forgetful", confirmed: true);
        client.Dispose();
        using var anonymous = Client();

        async Task<HttpStatusCode> AskAsync(string email) =>
            (await anonymous.PostAsJsonAsync(Api("/api/password-resets/request"), new { email })).StatusCode;

        Assert.Equal(HttpStatusCode.Accepted, await AskAsync(address));
        await SentAsync(address, EmailKinds.PasswordReset);

        // Again, while that link is live and its email arrived: nothing more.
        Assert.Equal(HttpStatusCode.Accepted, await AskAsync(address));
        await Task.Delay(500);
        Assert.Single(await FakeResend.MessagesToAsync(Host.Services, address), m => m.Kind == EmailKinds.PasswordReset);

        // The link it carried works.
        var token = _resend.To(address).Last(s => s.Kind == EmailKinds.PasswordReset).Token;
        var preview = await anonymous.GetFromJsonAsync<JsonElement>(Api($"/api/password-resets/{token}/preview"));
        Assert.True(preview.GetProperty("usable").GetBoolean());
    }

    [Fact]
    public async Task Forgot_password_answers_the_same_for_anybody_and_sends_only_to_a_confirmed_address()
    {
        var (unconfirmed, _, unconfirmedAddress) = await MemberAsync("unsure", confirmed: false);
        unconfirmed.Dispose();
        using var anonymous = Client();

        var nobody = await anonymous.PostAsJsonAsync(Api("/api/password-resets/request"), new { email = $"{Unique("ghost")}@example.com" });
        var unsure = await anonymous.PostAsJsonAsync(Api("/api/password-resets/request"), new { email = unconfirmedAddress });

        Assert.Equal(HttpStatusCode.Accepted, nobody.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, unsure.StatusCode);
        Assert.Equal(await nobody.Content.ReadAsStringAsync(), await unsure.Content.ReadAsStringAsync());

        await Task.Delay(500);
        Assert.DoesNotContain(await FakeResend.MessagesToAsync(Host.Services, unconfirmedAddress), m => m.Kind == EmailKinds.PasswordReset);
    }

    [Fact]
    public async Task A_reset_email_that_never_arrived_lets_forgot_password_try_again()
    {
        var (client, _, address) = await MemberAsync("unlucky", confirmed: true);
        client.Dispose();
        using var anonymous = Client();

        _resend.ThenFail(address, HttpStatusCode.UnprocessableEntity, "validation_error");

        (await anonymous.PostAsJsonAsync(Api("/api/password-resets/request"), new { email = address })).EnsureSuccessStatusCode();
        await FakeResend.EventuallyAsync(Host.Services, address, m => m.Kind == EmailKinds.PasswordReset && m.Status == EmailStatuses.Failed);

        (await anonymous.PostAsJsonAsync(Api("/api/password-resets/request"), new { email = address })).EnsureSuccessStatusCode();
        await FakeResend.EventuallyAsync(Host.Services, address, m => m.Kind == EmailKinds.PasswordReset && m.Status == EmailStatuses.Sent);
    }

    [Fact]
    public async Task An_admin_reset_is_emailed_only_to_a_confirmed_address()
    {
        using var admin = await HeadAdminAsync();
        var (unconfirmed, unsureSession, _) = await MemberAsync("adminreset", confirmed: false);
        var (confirmed, sureSession, sureAddress) = await MemberAsync("adminsure", confirmed: true);
        unconfirmed.Dispose();
        confirmed.Dispose();

        var unsure = await (await admin.PostAsync(Api($"/api/admin/users/{unsureSession.User.Id}/password-reset"), null))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("unverified", unsure.GetProperty("notEmailed").GetString());
        Assert.Equal(JsonValueKind.Null, unsure.GetProperty("mail").ValueKind);

        var sure = await (await admin.PostAsync(Api($"/api/admin/users/{sureSession.User.Id}/password-reset"), null))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, sure.GetProperty("notEmailed").ValueKind);
        Assert.Equal("queued", sure.GetProperty("mail").GetProperty("status").GetString());

        await SentAsync(sureAddress, EmailKinds.PasswordReset);
        Assert.Equal(sure.GetProperty("link").GetString(), _resend.To(sureAddress).Last(s => s.Kind == EmailKinds.PasswordReset).Link);
    }

    [Fact]
    public async Task A_reset_a_member_asked_for_is_never_shown_to_an_admin()
    {
        using var admin = await HeadAdminAsync();
        var (client, session, address) = await MemberAsync("private", confirmed: true);
        client.Dispose();
        using var anonymous = Client();

        (await anonymous.PostAsJsonAsync(Api("/api/password-resets/request"), new { email = address })).EnsureSuccessStatusCode();
        await SentAsync(address, EmailKinds.PasswordReset);

        var page = await admin.GetFromJsonAsync<JsonElement>(Api($"/api/admin/users/?q={session.User.Username}"));
        var row = Assert.Single(page.GetProperty("items").EnumerateArray());

        Assert.Equal(JsonValueKind.Null, row.GetProperty("passwordReset").ValueKind);
        Assert.Equal("sent", row.GetProperty("requestedReset").GetProperty("mail").GetProperty("status").GetString());
        Assert.True(row.GetProperty("emailConfirmed").GetBoolean());
        Assert.DoesNotContain("/reset-password/", row.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Changing_your_password_tells_you_by_email()
    {
        var (client, _, address) = await MemberAsync("rotator", confirmed: true);
        using var _client = client;

        var changed = await client.PostAsJsonAsync(
            Api("/api/auth/password"),
            new { currentPassword = FoxfireServerFixture.GoodPassword, newPassword = "another-long-enough-password" });
        changed.EnsureSuccessStatusCode();

        await SentAsync(address, EmailKinds.PasswordChanged);
        Assert.Contains(
            "/forgot-password",
            _resend.To(address).Last(s => s.Kind == EmailKinds.PasswordChanged).Text,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Moving_to_a_new_address_waits_for_the_new_address_to_confirm()
    {
        var (client, session, address) = await MemberAsync("mover", confirmed: true);
        using var _client = client;
        var moved = $"{Unique("moved")}@example.com";

        var asked = await client.PatchAsJsonAsync(
            Api("/api/auth/email"), new { email = moved, currentPassword = FoxfireServerFixture.GoodPassword });
        asked.EnsureSuccessStatusCode();
        var me = await asked.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(address, me.GetProperty("email").GetString());
        Assert.Equal(moved, me.GetProperty("pendingEmail").GetString());

        await SentAsync(moved, EmailKinds.EmailChange);
        var token = Assert.Single(_resend.To(moved)).Token;

        // Still the old address until the link is opened.
        var before = await client.GetFromJsonAsync<JsonElement>(Api("/api/auth/me"));
        Assert.Equal(address, before.GetProperty("email").GetString());
        Assert.Equal(moved, before.GetProperty("pendingEmail").GetString());

        using var anonymous = Client();
        (await anonymous.PostAsJsonAsync(Api("/api/email-verifications/confirm"), new { token })).EnsureSuccessStatusCode();

        var login = await anonymous.PostAsJsonAsync(
            Api("/api/auth/login"), new { email = moved, password = FoxfireServerFixture.GoodPassword });
        login.EnsureSuccessStatusCode();
        var after = (await login.Content.ReadFromJsonAsync<Session>())!;

        Assert.Equal(session.User.Id, after.User.Id);
        Assert.True(after.User.EmailConfirmed);
    }

    [Fact]
    public async Task A_move_can_be_cancelled_and_its_link_stops_working()
    {
        var (client, _, _) = await MemberAsync("wavering", confirmed: true);
        using var _client = client;
        var moved = $"{Unique("never")}@example.com";

        (await client.PatchAsJsonAsync(
            Api("/api/auth/email"), new { email = moved, currentPassword = FoxfireServerFixture.GoodPassword })).EnsureSuccessStatusCode();
        await SentAsync(moved, EmailKinds.EmailChange);
        var token = Assert.Single(_resend.To(moved)).Token;

        var cancelled = await client.DeleteAsync(Api("/api/account/email/pending"));
        var mine = await cancelled.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, mine.GetProperty("pendingEmail").ValueKind);

        var confirm = await client.PostAsJsonAsync(Api("/api/email-verifications/confirm"), new { token });
        Assert.Equal("confirmation_not_usable", (await confirm.Content.ReadFromJsonAsync<ApiError>())!.Error);
    }

    [Fact]
    public async Task Asking_for_another_confirmation_link_too_soon_is_refused()
    {
        var (client, _, address) = await MemberAsync("impatient", confirmed: false);
        using var _client = client;

        // The one sent at registration counts: another now is too soon.
        await SentAsync(address, EmailKinds.Verification);

        var resend = await client.PostAsync(Api("/api/account/email/confirmation"), null);
        Assert.Equal(HttpStatusCode.TooManyRequests, resend.StatusCode);
        Assert.Equal("confirmation_throttled", (await resend.Content.ReadFromJsonAsync<ApiError>())!.Error);

        var mine = await client.GetFromJsonAsync<JsonElement>(Api("/api/account/email"));
        Assert.True(mine.GetProperty("mailEnabled").GetBoolean());
        Assert.Equal(JsonValueKind.String, mine.GetProperty("canResendAt").ValueKind);
    }

    [Fact]
    public async Task A_head_admin_sends_a_test_and_reads_it_in_the_log()
    {
        using var admin = await HeadAdminAsync();
        var address = $"{Unique("tester")}@example.com";

        var test = await admin.PostAsJsonAsync(Api("/api/admin/email/test"), new { to = address });
        test.EnsureSuccessStatusCode();
        await SentAsync(address, EmailKinds.Test);

        var log = await admin.GetFromJsonAsync<JsonElement>(Api($"/api/admin/email/messages?q={address}"));
        var entry = Assert.Single(log.GetProperty("items").EnumerateArray());
        Assert.Equal("sent", entry.GetProperty("status").GetString());
        Assert.Equal("test", entry.GetProperty("kind").GetString());
        var me = await admin.GetFromJsonAsync<JsonElement>(Api("/api/auth/me"));
        Assert.Equal(me.GetProperty("username").GetString(), entry.GetProperty("triggeredBy").GetString());

        var overview = await admin.GetFromJsonAsync<JsonElement>(Api("/api/admin/email/"));
        Assert.True(overview.GetProperty("configured").GetBoolean());
        Assert.True(overview.GetProperty("tracksDelivery").GetBoolean());
        Assert.True(overview.GetProperty("today").GetProperty("ours").GetInt32() >= 1);
    }

    [Fact]
    public async Task An_outage_is_tried_again_under_the_same_idempotency_key()
    {
        using var admin = await HeadAdminAsync();
        var address = $"{Unique("outage")}@example.com";

        _resend.ThenFail(address, HttpStatusCode.ServiceUnavailable, "service_unavailable");

        (await admin.PostAsJsonAsync(Api("/api/admin/email/test"), new { to = address })).EnsureSuccessStatusCode();
        var waiting = await FakeResend.EventuallyAsync(
            Host.Services, address, m => m.Status == EmailStatuses.Queued && m.Attempts == 1);
        Assert.Equal("service_unavailable", waiting.Reason);

        // The backoff is half a minute; bring it forward rather than wait it out.
        await using (var scope = Host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            await db.EmailMessages.Where(m => m.Id == waiting.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.NotBefore, DateTimeOffset.UtcNow.AddSeconds(-1)));
        }

        var sent = await FakeResend.EventuallyAsync(Host.Services, address, m => m.Status == EmailStatuses.Sent);
        var attempts = _resend.To(address);

        Assert.Equal(2, attempts.Count);
        Assert.All(attempts, a => Assert.Equal(sent.Id.ToString(), a.IdempotencyKey));
        Assert.Equal(attempts[0].Html, attempts[1].Html);
    }

    [Fact]
    public async Task A_refused_key_holds_the_mail_rather_than_failing_it()
    {
        using var admin = await HeadAdminAsync();
        var address = $"{Unique("refused")}@example.com";

        _resend.ThenFail(address, HttpStatusCode.Forbidden, "restricted_api_key");

        (await admin.PostAsJsonAsync(Api("/api/admin/email/test"), new { to = address })).EnsureSuccessStatusCode();
        var held = await FakeResend.EventuallyAsync(Host.Services, address, m => m.Status == EmailStatuses.Held);

        Assert.Equal("provider_refused", held.Reason);
        Assert.Equal("restricted_api_key", held.Detail);

        var overview = await admin.GetFromJsonAsync<JsonElement>(Api("/api/admin/email/"));
        Assert.Equal("restricted_api_key", overview.GetProperty("refused").GetString());

        // Not left to block every later test's mail for an hour.
        await using var scope = Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        await db.EmailMessages.Where(m => m.Id == held.Id).ExecuteUpdateAsync(s => s.SetProperty(m => m.Status, EmailStatuses.Dropped));
    }
}
