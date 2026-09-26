using Foxfire.Api.Common;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Email;

/// <summary>One quota window, as the Email page draws its meter.</summary>
/// <param name="Used">What the limit is checked against: the larger of <paramref name="Ours"/> and <paramref name="Reported"/>.</param>
/// <param name="Ours">What this server sent in the window.</param>
/// <param name="Reported">What the provider last said had gone, when it said so inside this window.</param>
/// <param name="Limit">Zero is no cap.</param>
/// <param name="StandardAllowance">How much of the day invites and other standard mail may use. Daily only.</param>
/// <param name="LatchedUntil">When the provider itself said the window is spent: nothing goes before this.</param>
public sealed record EmailWindowResponse(
    int Used,
    int Ours,
    int? Reported,
    DateTimeOffset? ReportedAt,
    int Limit,
    int? StandardAllowance,
    DateTimeOffset StartsAt,
    DateTimeOffset ResetsAt,
    DateTimeOffset? LatchedUntil);

/// <param name="NextAttemptAt">When the first held message will be tried again.</param>
public sealed record EmailQueueResponse(int Queued, int Held, DateTimeOffset? NextAttemptAt);

/// <summary>Where the server's mail stands, for the head admins' Email page.</summary>
/// <param name="Configured">Whether this server sends mail at all. Everything else is empty when it does not.</param>
/// <param name="TracksDelivery">Whether a webhook secret is set, so delivery and bounces are known.</param>
/// <param name="Refused">The provider's reason, while it is refusing this server's mail — a bad key, an unverified domain.</param>
public sealed record EmailOverviewResponse(
    bool Configured,
    string? Provider,
    string? From,
    bool TracksDelivery,
    double InviteShare,
    int RetentionDays,
    EmailWindowResponse? Today,
    EmailWindowResponse? Month,
    EmailQueueResponse Queue,
    int Suppressed,
    string? Refused);

public sealed record GetEmailOverviewRequest : IDomainRequest<EmailOverviewResponse>;

internal sealed class GetEmailOverviewRequestHandler(FoxfireDbContext db, ActiveEmailProvider active, TimeProvider time)
    : IDomainRequestHandler<GetEmailOverviewRequest, EmailOverviewResponse>
{
    public async Task<Response<EmailOverviewResponse>> Handle(
        GetEmailOverviewRequest request,
        CancellationToken cancellationToken)
    {
        var options = active.Options;
        var suppressed = await db.EmailSuppressions.CountAsync(cancellationToken);

        if (active.Provider is not { } provider)
        {
            return new EmailOverviewResponse(
                false, null, null, false, options.InviteShare, options.RetentionDays, null, null,
                new EmailQueueResponse(0, 0, null), suppressed, null);
        }

        var now = time.GetUtcNow();
        var quota = await EmailQuota.ReadAsync(db, provider, now, cancellationToken);

        var pending = await db.EmailMessages
            .Where(m => m.Provider == provider.Name)
            .Where(m => m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Sending || m.Status == EmailStatuses.Held)
            .GroupBy(m => m.Status)
            .Select(g => new { Status = g.Key, Count = g.Count(), Next = g.Min(m => m.NotBefore) })
            .ToListAsync(cancellationToken);

        var held = pending.FirstOrDefault(p => p.Status == EmailStatuses.Held);

        // From the rows rather than this process's memory, so every process
        // answers the same.
        var refused = await db.EmailMessages
            .Where(m => m.Provider == provider.Name && m.Status == EmailStatuses.Held && m.Reason == "provider_refused")
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => m.Detail ?? "refused")
            .FirstOrDefaultAsync(cancellationToken);

        return new EmailOverviewResponse(
            true,
            provider.Name,
            active.From,
            active.TracksDelivery,
            options.InviteShare,
            options.RetentionDays,
            Window(quota.Daily, EmailBudget.StandardAllowance(quota.Daily.State.Limit, options.InviteShare)),
            Window(quota.Monthly, null),
            new EmailQueueResponse(
                pending.Where(p => p.Status != EmailStatuses.Held).Sum(p => p.Count),
                held?.Count ?? 0,
                held?.Next),
            suppressed,
            refused);
    }

    private static EmailWindowResponse Window(EmailQuotaWindowReading reading, int? standard) => new(
        reading.State.Used,
        reading.Ours,
        reading.Reported,
        reading.ReportedAt,
        reading.State.Limit,
        reading.State.IsCapped ? standard : null,
        reading.State.Window.Start,
        reading.State.Window.End,
        reading.State.LatchedUntil);
}
