using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Email;

/// <summary>One email in the log. Never its body: that carried a link, and links are not kept.</summary>
/// <param name="Reason">Why it is where it is: daily_limit on a held one, the provider's error on a failed one.</param>
/// <param name="Detail">What the provider said about a bounce or failure.</param>
/// <param name="NotBefore">For one waiting, when it will next be tried.</param>
/// <param name="TriggeredBy">Who caused it to be sent, when that was somebody.</param>
public sealed record EmailLogEntry(
    Guid Id,
    string Kind,
    string Recipient,
    string Subject,
    string Status,
    string? Reason,
    string? Detail,
    int Attempts,
    DateTimeOffset CreatedAt,
    DateTimeOffset? NotBefore,
    DateTimeOffset? SentAt,
    DateTimeOffset? DeliveredAt,
    DateTimeOffset? LastEventAt,
    string? TriggeredBy);

/// <summary>
/// Every email the server has sent or meant to, newest first, a page at a time.
///
/// Paged, because it grows with the community — kept for Email__RetentionDays,
/// a free plan's worth is three thousand rows a month. Head admins only: it is
/// a list of members' addresses.
/// </summary>
/// <param name="Kind">One of invite, password_reset, verification, email_change, password_changed, test.</param>
/// <param name="Status">One status, or <c>pending</c> for everything still to go.</param>
/// <param name="Q">Part of a recipient's address, any case.</param>
public sealed record ListEmailMessagesRequest(
    string? Kind = null,
    string? Status = null,
    string? Q = null,
    int? Limit = null,
    int? Offset = null) : IDomainRequest<Page<EmailLogEntry>>;

internal sealed class ListEmailMessagesRequestHandler(FoxfireDbContext db)
    : IDomainRequestHandler<ListEmailMessagesRequest, Page<EmailLogEntry>>
{
    public async Task<Response<Page<EmailLogEntry>>> Handle(
        ListEmailMessagesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var query = db.EmailMessages.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(request.Kind))
        {
            var kind = request.Kind.Trim().ToLowerInvariant();
            if (!EmailKinds.All.Contains(kind)) return Unknown("kind", request.Kind, EmailKinds.All);
            query = query.Where(m => m.Kind == kind);
        }

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            var status = request.Status.Trim().ToLowerInvariant();

            if (status == "pending")
            {
                query = query.Where(m =>
                    m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Sending || m.Status == EmailStatuses.Held);
            }
            else
            {
                if (!EmailStatuses.All.Contains(status)) return Unknown("status", request.Status, [.. EmailStatuses.All, "pending"]);
                query = query.Where(m => m.Status == status);
            }
        }

        var needle = (request.Q ?? "").Trim().ToLowerInvariant();
        if (needle.Length > 0) query = query.Where(m => m.Recipient.ToLower().Contains(needle));

        var page = await query
            .OrderByDescending(m => m.CreatedAt)
            .ThenByDescending(m => m.Id)
            .Select(m => new EmailLogEntry(
                m.Id,
                m.Kind,
                m.Recipient,
                m.Subject,
                m.Status,
                m.Reason,
                m.Detail,
                m.Attempts,
                m.CreatedAt,
                m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Held ? m.NotBefore : null,
                m.SentAt,
                m.DeliveredAt,
                m.LastEventAt,
                db.Users.Where(u => u.Id == m.TriggeredByUserId).Select(u => u.UserName).FirstOrDefault()))
            .ToPageAsync(PageRequest.Of(request.Limit, request.Offset), cancellationToken);

        return page;
    }

    private static Response<Page<EmailLogEntry>> Unknown(string what, string value, IEnumerable<string> known) =>
        new Error($"invalid_{what}", $"There is no {what} '{value}'. Use one of: {string.Join(", ", known)}.");
}
