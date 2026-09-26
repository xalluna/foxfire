namespace Foxfire.Email.Resend;

/// <summary>
/// A Resend account, as Email__Resend__* describes it.
///
/// The limits are the account's plan, which is why they live here rather than
/// beside the provider-agnostic settings. The defaults are the free plan's: a
/// hundred a day and three thousand a month, both of which Resend refuses to
/// go past. A paid plan has no daily cap — set DailyLimit to 0 — and a monthly
/// allowance past which every message is charged for.
/// </summary>
public sealed class ResendOptions
{
    /// <summary>
    /// An API key from resend.com/api-keys, re_…. A sending-only key is
    /// enough, and the better choice: it can do nothing else with the account.
    /// </summary>
    public string ApiKey { get; set; } = "";

    /// <summary>
    /// The signing secret of the webhook pointed at this server, whsec_….
    /// Optional; without it messages are tracked as far as "sent" and no
    /// further, and a bounce goes unnoticed.
    /// </summary>
    public string WebhookSecret { get; set; } = "";

    /// <summary>Messages per UTC day. Zero is no cap.</summary>
    public int DailyLimit { get; set; } = 100;

    /// <summary>Messages per month. Zero is no cap.</summary>
    public int MonthlyLimit { get; set; } = 3000;

    /// <summary>The day the monthly count resets: the billing day on Resend's usage page.</summary>
    public int MonthlyResetDay { get; set; } = 1;

    public EmailLimits Limits => new(DailyLimit, MonthlyLimit, MonthlyResetDay);
}
