using Foxfire.Api.Configuration;
using Foxfire.Email.Resend;

namespace Foxfire.Api.Tests;

/// <summary>
/// Mail is optional, and a half-configured provider stops the server — it
/// would otherwise hold or lose every message while the host believed it worked.
/// </summary>
public sealed class EmailConfigurationTests
{
    private static IReadOnlyList<string> Check(EmailOptions email) =>
        ConfigurationCheck.Validate(
            "Server=db;Database=Foxfire",
            new ServerOptions { PublicUrl = "https://foxfire.example.com" },
            new RiotOptions { ApiKey = "RGAPI-test" },
            new AuthOptions
            {
                JwtSigningKey = "PSZoLQdDOTJXHJv3fjGEKPI4sMmY9uD0rCtNbVkWaXc=",
                InviteSigningKey = "lRk2yNqTgWv8eBmZ6uAoHx4JdFsCpQ1iXyU3nEwK7Vg="
            },
            new AdminOptions { Email = "admin@example.com" },
            new RateLimitOptions(),
            new LogOptions(),
            new TelemetryOptions(),
            email);

    private static EmailOptions Resend(Action<ResendOptions>? change = null)
    {
        var resend = new ResendOptions { ApiKey = "re_test" };
        change?.Invoke(resend);
        return new EmailOptions { Provider = "resend", FromAddress = "foxfire@mail.example.com", Resend = resend };
    }

    private static void Refused(EmailOptions email, string setting) =>
        Assert.Contains(Check(email), p => p.StartsWith(setting, StringComparison.Ordinal));

    [Fact]
    public void No_mail_starts() => Assert.Empty(Check(new EmailOptions()));

    [Fact]
    public void Resend_with_a_key_and_an_address_starts() => Assert.Empty(Check(Resend()));

    [Fact]
    public void The_provider_is_named_in_any_case() =>
        Assert.Empty(Check(new EmailOptions { Provider = "Resend", FromAddress = "a@b.example", Resend = new ResendOptions { ApiKey = "re_x" } }));

    [Fact]
    public void A_provider_nobody_wrote_is_refused() =>
        Refused(new EmailOptions { Provider = "carrier-pigeon", FromAddress = "a@b.example" }, "Email__Provider");

    [Fact]
    public void Resend_without_a_key_is_refused() => Refused(Resend(r => r.ApiKey = ""), "Email__Resend__ApiKey");

    [Fact]
    public void No_from_address_is_refused() =>
        Refused(new EmailOptions { Provider = "resend", Resend = new ResendOptions { ApiKey = "re_x" } }, "Email__FromAddress");

    [Theory]
    [InlineData("not an address")]
    [InlineData("Foxfire <mail@example.com>")]
    public void A_from_address_that_is_not_one_is_refused(string from) =>
        Refused(new EmailOptions { Provider = "resend", FromAddress = from, Resend = new ResendOptions { ApiKey = "re_x" } }, "Email__FromAddress");

    [Theory]
    [InlineData(1)]
    [InlineData(34)]
    [InlineData(-1)]
    public void Retention_shorter_than_a_month_is_refused(int days) =>
        Refused(new EmailOptions { RetentionDays = days }, "Email__RetentionDays");

    [Theory]
    [InlineData(0)]
    [InlineData(35)]
    public void Retention_for_good_or_past_a_month_starts(int days) =>
        Assert.Empty(Check(new EmailOptions { RetentionDays = days }));

    [Theory]
    [InlineData(0)]
    [InlineData(1.2)]
    public void A_share_outside_the_day_is_refused(double share) =>
        Refused(new EmailOptions { InviteShare = share }, "Email__InviteShare");

    [Fact]
    public void A_negative_limit_is_refused() => Refused(Resend(r => r.DailyLimit = -1), "Email__Resend__DailyLimit");

    [Theory]
    [InlineData(0)]
    [InlineData(32)]
    public void A_reset_day_that_is_not_one_is_refused(int day) =>
        Refused(Resend(r => r.MonthlyResetDay = day), "Email__Resend__MonthlyResetDay");

    [Fact]
    public void A_webhook_secret_that_is_not_one_is_refused() =>
        Refused(Resend(r => r.WebhookSecret = "not-a-secret"), "Email__Resend__WebhookSecret");

    [Fact]
    public void A_paid_plan_with_no_daily_cap_starts() =>
        Assert.Empty(Check(Resend(r =>
        {
            r.DailyLimit = 0;
            r.MonthlyLimit = 50_000;
            r.MonthlyResetDay = 14;
        })));
}
