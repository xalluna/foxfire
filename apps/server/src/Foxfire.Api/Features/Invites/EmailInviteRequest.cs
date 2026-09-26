using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>
/// Emails an invite's link to its address — again, after the last attempt
/// failed, bounced softly or was dropped, or for the first time, for an invite
/// made before this server had a provider.
///
/// Never while an email for it is on its way or has arrived: that would be the
/// same link twice in somebody's inbox, and one more message against the day.
/// </summary>
public sealed record EmailInviteRequest(Guid Id) : IDomainRequest<InviteResponse>;

internal sealed class EmailInviteRequestHandler(
    FoxfireDbContext db,
    EmailOutbox outbox,
    IIdentityContext me,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time,
    ILogger<EmailInviteRequestHandler> logger)
    : IDomainRequestHandler<EmailInviteRequest, InviteResponse>
{
    public async Task<Response<InviteResponse>> Handle(EmailInviteRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var invite = await db.Invites.Include(i => i.RedeemedBy).FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);
        if (invite is null) return Response<InviteResponse>.NotFound();

        var now = time.GetUtcNow();

        if (!outbox.IsEnabled)
        {
            return new Error("email_unavailable", "This server doesn't send email. Copy the link instead.");
        }

        if (!invite.IsOpen(now))
        {
            return new Error("invite_not_open", "That invite has been used, withdrawn or has expired.");
        }

        if (invite.Email is not { } address)
        {
            return new Error("invite_has_no_address", "That invite has no address to send it to. Copy the link instead.");
        }

        var described = (await InviteLookup.DescribeWithMailAsync(
            [invite], db, outbox.IsEnabled, server.Value, auth.Value, now, cancellationToken))[0];

        if (!described.CanEmail)
        {
            return await outbox.IsSuppressedAsync(address, cancellationToken)
                ? new Error(
                    "email_suppressed",
                    "Mail to that address bounced, so this server no longer sends to it. A head admin can clear it on the Email page.")
                : new Error("invite_email_in_progress", "The email for that invite is already on its way, or has arrived.");
        }

        await outbox.AddAsync(
            EmailKinds.Invite,
            EmailPriority.Standard,
            address,
            relatedId: invite.Id,
            userId: null,
            triggeredBy: me.UserId,
            worthlessAfter: invite.ExpiresAt,
            cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("{Actor} emailed invite {InviteId} to {Email}", me.Username, invite.Id, address);

        return (await InviteLookup.DescribeWithMailAsync(
            [invite], db, outbox.IsEnabled, server.Value, auth.Value, now, cancellationToken))[0];
    }
}
