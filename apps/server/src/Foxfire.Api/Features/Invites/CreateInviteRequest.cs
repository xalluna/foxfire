using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>Permission for one address to register while public signup is off.</summary>
public sealed record CreateInviteRequest(string Email) : IValidatedRequest<InviteResponse>;

internal sealed class CreateInviteRequestValidator : AbstractValidator<CreateInviteRequest>
{
    public CreateInviteRequestValidator() =>
        RuleFor(x => (x.Email ?? string.Empty).Trim())
            .Must(email => !string.IsNullOrWhiteSpace(email) && email.Contains('@', StringComparison.Ordinal))
            .WithErrorCode("invalid_email")
            .WithMessage("That does not look like an email address.");
}

internal sealed class CreateInviteRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IValidatedRequestHandler<CreateInviteRequest, InviteResponse>
{
    public async Task<Response<InviteResponse>> Handle(
        CreateInviteRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var email = (request.Email ?? "").Trim();
        var now = time.GetUtcNow();

        // An outstanding invite for this address is handed back rather than
        // duplicated. An admin who cannot remember whether they already sent one
        // should get the same link again, not a second one that quietly
        // invalidates nothing and confuses both of them.
        var existing = await db.Invites
            .Include(i => i.RedeemedBy)
            .Where(i => i.Email == email && i.RedeemedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
            .OrderByDescending(i => i.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (existing is not null)
        {
            return InviteLookup.Describe(existing, server.Value, auth.Value, now);
        }

        var invite = new Invite
        {
            Id = Guid.CreateVersion7(now),
            Email = email,
            CreatedByUserId = me.UserId,
            CreatedAt = now,
            ExpiresAt = now + auth.Value.InviteLifetime
        };

        db.Invites.Add(invite);
        await db.SaveChangesAsync(cancellationToken);

        return InviteLookup.Describe(invite, server.Value, auth.Value, now);
    }
}
