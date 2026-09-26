using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Email;

/// <param name="Member">Who signs in with this address now, if anybody does.</param>
public sealed record EmailSuppressionResponse(
    Guid Id,
    string Address,
    string Reason,
    string? Detail,
    DateTimeOffset CreatedAt,
    string? Member);

/// <summary>
/// The addresses mail is no longer sent to, newest first, a page at a time.
/// Paged, because every bounce adds one and nothing takes them away but a head
/// admin.
/// </summary>
public sealed record ListEmailSuppressionsRequest(string? Q = null, int? Limit = null, int? Offset = null)
    : IDomainRequest<Page<EmailSuppressionResponse>>;

internal sealed class ListEmailSuppressionsRequestHandler(FoxfireDbContext db)
    : IDomainRequestHandler<ListEmailSuppressionsRequest, Page<EmailSuppressionResponse>>
{
    public async Task<Response<Page<EmailSuppressionResponse>>> Handle(
        ListEmailSuppressionsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var query = db.EmailSuppressions.AsNoTracking();

        var needle = (request.Q ?? "").Trim().ToLowerInvariant();
        if (needle.Length > 0) query = query.Where(s => s.Address.Contains(needle));

        return await query
            .OrderByDescending(s => s.CreatedAt)
            .ThenByDescending(s => s.Id)
            .Select(s => new EmailSuppressionResponse(
                s.Id,
                s.Address,
                s.Reason,
                s.Detail,
                s.CreatedAt,
                db.Users.Where(u => u.NormalizedEmail == s.Address.ToUpper()).Select(u => u.UserName).FirstOrDefault()))
            .ToPageAsync(PageRequest.Of(request.Limit, request.Offset), cancellationToken);
    }
}
