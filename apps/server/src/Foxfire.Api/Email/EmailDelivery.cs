using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Email;

/// <summary>What became of the email that carried an invite or a reset, as the admin lists show it.</summary>
/// <param name="Status">queued, sending, held, sent, delivered, bounced, complained, failed or dropped.</param>
/// <param name="Reason">Why, where the status alone does not say: daily_limit on a held one, hard_bounce on a bounce.</param>
/// <param name="NotBefore">For a held message, when it will be tried again.</param>
public sealed record EmailDeliveryResponse(
    string Status,
    string? Reason,
    DateTimeOffset QueuedAt,
    DateTimeOffset? NotBefore,
    DateTimeOffset? SentAt,
    DateTimeOffset? DeliveredAt);

/// <summary>The mail about invites and resets, looked up for a page of them at once.</summary>
internal static class EmailDeliveries
{
    /// <summary>The newest message of a kind about each of <paramref name="relatedIds"/>. One query for the page.</summary>
    public static async Task<Dictionary<Guid, EmailMessage>> LatestAsync(
        FoxfireDbContext db,
        string kind,
        IReadOnlyCollection<Guid> relatedIds,
        CancellationToken cancellationToken)
    {
        if (relatedIds.Count == 0) return [];

        var ids = relatedIds.ToList();
        var rows = await db.EmailMessages
            .AsNoTracking()
            .Where(m => m.Kind == kind && m.RelatedId != null && ids.Contains(m.RelatedId.Value))
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(m => m.RelatedId!.Value)
            .ToDictionary(
                group => group.Key,
                group => group.OrderByDescending(m => m.CreatedAt).ThenByDescending(m => m.Id).First());
    }

    /// <summary>Which of these addresses mail is not sent to.</summary>
    public static async Task<HashSet<string>> SuppressedAsync(
        FoxfireDbContext db,
        IEnumerable<string?> addresses,
        CancellationToken cancellationToken)
    {
        var normalized = addresses
            .Where(a => !string.IsNullOrWhiteSpace(a))
            .Select(a => EmailSuppression.Normalize(a!))
            .Distinct()
            .ToList();

        if (normalized.Count == 0) return [];

        var found = await db.EmailSuppressions
            .AsNoTracking()
            .Where(s => normalized.Contains(s.Address))
            .Select(s => s.Address)
            .ToListAsync(cancellationToken);

        return [.. found];
    }

    /// <summary>Whether a message's story ended without it arriving, so that trying again could help.</summary>
    public static bool EndedWithoutArriving(EmailMessage message) =>
        message.Status is EmailStatuses.Failed or EmailStatuses.Bounced or EmailStatuses.Dropped;

    public static EmailDeliveryResponse Describe(EmailMessage message) => new(
        message.Status,
        message.Reason,
        message.CreatedAt,
        message.Status == EmailStatuses.Held ? message.NotBefore : null,
        message.SentAt,
        message.DeliveredAt);
}
