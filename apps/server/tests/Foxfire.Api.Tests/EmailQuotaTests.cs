using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The server keeping itself under the provider's limits: holding mail when the
/// day is full, keeping a share of it for account security, and believing the
/// provider when it says the quota is spent.
///
/// The day's count is read off the database every host shares, so these start
/// from an empty outbox and clear it again afterwards — a held message, or a
/// latch, left behind would hold every later test's mail until midnight.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public sealed class EmailQuotaTests(FoxfireServerFixture server) : IAsyncLifetime
{
    private readonly FakeResend _resend = new();
    private readonly List<WebApplicationFactory<Program>> _hosts = [];

    public Task InitializeAsync() => ClearAsync();

    public async Task DisposeAsync()
    {
        foreach (var host in _hosts) await host.DisposeAsync();
        await ClearAsync();
    }

    private async Task ClearAsync()
    {
        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        await db.EmailMessages.ExecuteDeleteAsync();
        await db.EmailQuotaObservations.ExecuteDeleteAsync();
    }

    private WebApplicationFactory<Program> Host(int dailyLimit, double share = 0.8)
    {
        var host = _resend.Host(server.Factory, new Dictionary<string, string?>
        {
            ["Email:Resend:DailyLimit"] = dailyLimit.ToString(CultureInfo.InvariantCulture),
            ["Email:InviteShare"] = share.ToString(CultureInfo.InvariantCulture)
        });

        _hosts.Add(host);
        return host;
    }

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..Math.Min(30, prefix.Length + 12)];

    private async Task<HttpClient> HeadAdminAsync(WebApplicationFactory<Program> host)
    {
        var (fixtureClient, session) = await server.AdminAsync();
        fixtureClient.Dispose();

        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        return FoxfireServerFixture.Authenticated(client, session);
    }

    private static async Task TestSendAsync(HttpClient admin, string to) =>
        (await admin.PostAsJsonAsync(new Uri("/api/admin/email/test", UriKind.Relative), new { to })).EnsureSuccessStatusCode();

    /// <summary>A confirmed member, registered through the fixture's host so that nothing is queued for them.</summary>
    private async Task<string> ConfirmedMemberAsync()
    {
        var name = Unique("quota");
        var email = $"{name.ToLowerInvariant()}@example.com";

        using var client = server.Client();
        var session = await server.RegisterAsync(client, name, email);

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        await db.Users.Where(u => u.Id == session.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, true));

        return email;
    }

    [Fact]
    public async Task When_the_provider_says_the_day_is_full_mail_waits_for_utc_midnight()
    {
        var host = Host(dailyLimit: 100);
        using var admin = await HeadAdminAsync(host);

        // The first goes; its answer says the account has used the day.
        _resend.ReportDaily = 100;
        var first = $"{Unique("first")}@example.com";
        await TestSendAsync(admin, first);
        await FakeResend.EventuallyAsync(host.Services, first, m => m.Status == EmailStatuses.Sent);

        var second = $"{Unique("second")}@example.com";
        await TestSendAsync(admin, second);
        var held = await FakeResend.EventuallyAsync(host.Services, second, m => m.Status == EmailStatuses.Held);

        Assert.Equal(EmailBudget.DailyLimit, held.Reason);
        Assert.Equal(EmailWindows.Day(DateTimeOffset.UtcNow).End, held.NotBefore);
        Assert.Empty(_resend.To(second));
    }

    [Fact]
    public async Task Standard_mail_stops_at_its_share_while_a_reset_still_goes()
    {
        var host = Host(dailyLimit: 4, share: 0.5);
        using var admin = await HeadAdminAsync(host);
        var member = await ConfirmedMemberAsync();

        for (var i = 0; i < 2; i++)
        {
            var to = $"{Unique("share")}@example.com";
            await TestSendAsync(admin, to);
            await FakeResend.EventuallyAsync(host.Services, to, m => m.Status == EmailStatuses.Sent);
        }

        var third = $"{Unique("over")}@example.com";
        await TestSendAsync(admin, third);
        var held = await FakeResend.EventuallyAsync(host.Services, third, m => m.Status == EmailStatuses.Held);
        Assert.Equal(EmailBudget.StandardShare, held.Reason);

        using var anonymous = host.CreateClient();
        anonymous.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        (await anonymous.PostAsJsonAsync(
            new Uri("/api/password-resets/request", UriKind.Relative), new { email = member })).EnsureSuccessStatusCode();

        await FakeResend.EventuallyAsync(host.Services, member, m => m.Kind == EmailKinds.PasswordReset && m.Status == EmailStatuses.Sent);
    }

    [Fact]
    public async Task A_spent_quota_from_the_provider_holds_everything_until_it_resets()
    {
        var host = Host(dailyLimit: 0);
        using var admin = await HeadAdminAsync(host);

        var refused = $"{Unique("spent")}@example.com";
        _resend.ThenFail(refused, HttpStatusCode.TooManyRequests, "daily_quota_exceeded");

        await TestSendAsync(admin, refused);
        var held = await FakeResend.EventuallyAsync(host.Services, refused, m => m.Status == EmailStatuses.Held);
        Assert.Equal(EmailBudget.ProviderQuota, held.Reason);
        Assert.Equal(EmailWindows.Day(DateTimeOffset.UtcNow).End, held.NotBefore);

        // Security mail too: the provider has said no to everything.
        var member = await ConfirmedMemberAsync();
        using var anonymous = host.CreateClient();
        anonymous.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        (await anonymous.PostAsJsonAsync(
            new Uri("/api/password-resets/request", UriKind.Relative), new { email = member })).EnsureSuccessStatusCode();

        var reset = await FakeResend.EventuallyAsync(host.Services, member, m => m.Status == EmailStatuses.Held);
        Assert.Equal(EmailBudget.ProviderQuota, reset.Reason);
        Assert.Empty(_resend.To(member));
    }

    [Fact]
    public async Task A_rate_limit_waits_as_long_as_the_provider_says_and_does_not_count_the_attempt()
    {
        var host = Host(dailyLimit: 0);
        using var admin = await HeadAdminAsync(host);

        var to = $"{Unique("hasty")}@example.com";
        _resend.ThenFail(to, HttpStatusCode.TooManyRequests, "rate_limit_exceeded", retryAfterSeconds: 1);

        await TestSendAsync(admin, to);
        var sent = await FakeResend.EventuallyAsync(host.Services, to, m => m.Status == EmailStatuses.Sent);

        Assert.Equal(2, _resend.To(to).Count);
        Assert.Equal(1, sent.Attempts);
    }
}
