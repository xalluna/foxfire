namespace Foxfire.Email;

/// <summary>Which messages go first when there is not room for all of them.</summary>
public enum EmailPriority
{
    /// <summary>
    /// Account security: resets, confirming a new address, telling somebody
    /// their password changed. Only the limits themselves stop these.
    /// </summary>
    Security = 0,

    /// <summary>
    /// Everything else — invites, test sends, the confirmation sent when an
    /// account is made. These stop at a share of the day, so that a batch of
    /// invites or a run of sign-ups cannot use up what a locked-out member
    /// needs.
    /// </summary>
    Standard = 1
}

/// <summary>Where one window stands.</summary>
/// <param name="Used">Messages counted against it so far — the larger of the server's count and the provider's.</param>
/// <param name="Limit">Zero is no cap.</param>
/// <param name="LatchedUntil">
/// When the provider itself said this window is spent, the end of the window it
/// said it about. Nothing goes before then, whatever the counts say.
/// </param>
public readonly record struct EmailWindowState(int Used, int Limit, EmailWindow Window, DateTimeOffset? LatchedUntil)
{
    public bool IsCapped => Limit > 0;
}

/// <summary>Whether one more message may go now.</summary>
public abstract record EmailBudgetDecision
{
    public sealed record Admit : EmailBudgetDecision;

    /// <param name="Until">When to look again: the end of whichever window is full.</param>
    /// <param name="Reason">daily_limit, monthly_limit, standard_share or provider_quota.</param>
    public sealed record Hold(DateTimeOffset Until, string Reason) : EmailBudgetDecision;
}

/// <summary>
/// The server's own limit on what it sends, kept below the provider's so the
/// provider never has to refuse it.
///
/// Pure arithmetic, so the rules can be read and tested apart from the queue
/// that follows them.
/// </summary>
public static class EmailBudget
{
    public const string DailyLimit = "daily_limit";
    public const string MonthlyLimit = "monthly_limit";
    public const string StandardShare = "standard_share";
    public const string ProviderQuota = "provider_quota";

    /// <summary>
    /// How much of a window has gone: what the server has sent in it, or what
    /// the provider last said, whichever is more.
    ///
    /// The provider's figure counts only if it was taken inside this window. One
    /// from yesterday says nothing about today, and trusting it would hold a
    /// whole day's mail over a count that has already reset.
    /// </summary>
    public static int Used(int ours, int? reported, DateTimeOffset? reportedAt, EmailWindow window) =>
        reported is { } theirs && reportedAt is { } at && window.Contains(at) ? Math.Max(ours, theirs) : ours;

    /// <summary>How many messages of the standard kind a day allows. Never none, when the day allows any.</summary>
    public static int StandardAllowance(int dailyLimit, double share) =>
        dailyLimit <= 0 ? 0 : Math.Clamp((int)Math.Floor(dailyLimit * share), 1, dailyLimit);

    /// <summary>
    /// Whether a message of <paramref name="priority"/> may go now, or until
    /// when it has to wait.
    ///
    /// The month is looked at first: when both are full, the month is the
    /// longer wait, and holding until tomorrow would only mean asking again
    /// tomorrow. The share applies to the day only — the month is one pool.
    /// </summary>
    public static EmailBudgetDecision Decide(
        EmailPriority priority,
        double standardShare,
        EmailWindowState daily,
        EmailWindowState monthly,
        DateTimeOffset now)
    {
        if (monthly.LatchedUntil is { } monthLatch && monthLatch > now)
        {
            return new EmailBudgetDecision.Hold(monthLatch, ProviderQuota);
        }

        if (monthly.IsCapped && monthly.Used >= monthly.Limit)
        {
            return new EmailBudgetDecision.Hold(monthly.Window.End, MonthlyLimit);
        }

        if (daily.LatchedUntil is { } dayLatch && dayLatch > now)
        {
            return new EmailBudgetDecision.Hold(dayLatch, ProviderQuota);
        }

        if (daily.IsCapped && daily.Used >= daily.Limit)
        {
            return new EmailBudgetDecision.Hold(daily.Window.End, DailyLimit);
        }

        if (priority == EmailPriority.Standard
            && daily.IsCapped
            && daily.Used >= StandardAllowance(daily.Limit, standardShare))
        {
            return new EmailBudgetDecision.Hold(daily.Window.End, StandardShare);
        }

        return new EmailBudgetDecision.Admit();
    }
}
