using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Email;

/// <summary>One window, counted both ways.</summary>
/// <param name="Ours">What this server sent in it, by the log.</param>
/// <param name="Reported">What the provider last said had gone, if it said so inside this window.</param>
public sealed record EmailQuotaWindowReading(EmailWindowState State, int Ours, int? Reported, DateTimeOffset? ReportedAt);

public sealed record EmailQuotaReading(EmailQuotaWindowReading Daily, EmailQuotaWindowReading Monthly);

/// <summary>
/// How much of a provider's quota has gone, read the one way both the
/// dispatcher and the admin page read it.
///
/// This server's count is the messages the provider accepted in the window —
/// anything with a <see cref="EmailMessage.SentAt"/>, whatever became of it
/// after, because a bounce was still sent. The provider's count is whatever it
/// said last, and it wins when it is larger.
/// </summary>
internal static class EmailQuota
{
    public static async Task<EmailQuotaReading> ReadAsync(
        FoxfireDbContext db,
        IEmailProvider provider,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var limits = provider.Limits;
        var day = EmailWindows.Day(now);
        var month = EmailWindows.Month(now, limits.MonthlyResetDay);

        var ourDay = await db.EmailMessages.CountAsync(
            m => m.Provider == provider.Name && m.SentAt >= day.Start && m.SentAt < day.End,
            cancellationToken);

        var ourMonth = await db.EmailMessages.CountAsync(
            m => m.Provider == provider.Name && m.SentAt >= month.Start && m.SentAt < month.End,
            cancellationToken);

        var observed = await db.EmailQuotaObservations
            .AsNoTracking()
            .Where(o => o.Provider == provider.Name)
            .ToListAsync(cancellationToken);

        return new EmailQuotaReading(
            Window(ourDay, limits.DailyLimit, day, observed.FirstOrDefault(o => o.Window == EmailQuotaWindows.Daily)),
            Window(ourMonth, limits.MonthlyLimit, month, observed.FirstOrDefault(o => o.Window == EmailQuotaWindows.Monthly)));
    }

    /// <summary>Keeps what the provider said about its quota, window by window.</summary>
    public static async Task ObserveAsync(
        FoxfireDbContext db,
        string provider,
        QuotaObservation usage,
        CancellationToken cancellationToken)
    {
        if (usage.DailyUsed is { } daily) await UpsertAsync(db, provider, EmailQuotaWindows.Daily, o =>
        {
            o.Used = daily;
            o.ObservedAt = usage.At;
        }, cancellationToken);

        if (usage.MonthlyUsed is { } monthly) await UpsertAsync(db, provider, EmailQuotaWindows.Monthly, o =>
        {
            o.Used = monthly;
            o.ObservedAt = usage.At;
        }, cancellationToken);
    }

    /// <summary>The provider said a window is spent: nothing goes until <paramref name="until"/>.</summary>
    public static Task LatchAsync(
        FoxfireDbContext db,
        string provider,
        QuotaWindow window,
        DateTimeOffset until,
        CancellationToken cancellationToken) =>
        UpsertAsync(
            db,
            provider,
            window == QuotaWindow.Daily ? EmailQuotaWindows.Daily : EmailQuotaWindows.Monthly,
            o => o.ExhaustedUntil = until,
            cancellationToken);

    private static EmailQuotaWindowReading Window(int ours, int limit, EmailWindow window, EmailQuotaObservation? observed)
    {
        var reported = observed is not null && window.Contains(observed.ObservedAt) ? observed.Used : (int?)null;
        var used = EmailBudget.Used(ours, observed?.Used, observed?.ObservedAt, window);

        return new EmailQuotaWindowReading(
            new EmailWindowState(used, limit, window, observed?.ExhaustedUntil),
            ours,
            reported,
            reported is null ? null : observed?.ObservedAt);
    }

    private static async Task UpsertAsync(
        FoxfireDbContext db,
        string provider,
        string window,
        Action<EmailQuotaObservation> change,
        CancellationToken cancellationToken)
    {
        var row = await db.EmailQuotaObservations.FirstOrDefaultAsync(
            o => o.Provider == provider && o.Window == window, cancellationToken);

        if (row is null)
        {
            row = new EmailQuotaObservation { Provider = provider, Window = window };
            db.EmailQuotaObservations.Add(row);
        }

        change(row);
        await db.SaveChangesAsync(cancellationToken);
    }
}
