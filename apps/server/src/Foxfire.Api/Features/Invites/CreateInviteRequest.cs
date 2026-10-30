using System.Net;
using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Email;
using Foxfire.Api.Features.PasswordResets;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>
/// Permission for one person to register, and a record of who it brought in.
///
/// The address is optional. Without one the invite is a link for whoever opens
/// it first — the admin pastes it into Discord. With one, registration must use
/// that address, and a server that sends mail emails the link there too.
/// </summary>
public sealed record CreateInviteRequest(string? Email) : IValidatedRequest<InviteResponse>;

internal sealed class CreateInviteRequestValidator : AbstractValidator<CreateInviteRequest>
{
    public CreateInviteRequestValidator() =>
        RuleFor(x => (x.Email ?? string.Empty).Trim())
            .Must(email => email.Length == 0 || email.Contains('@', StringComparison.Ordinal))
            .WithErrorCode("invalid_email")
            .WithMessage("That does not look like an email address.");
}

internal sealed class CreateInviteRequestHandler(
    FoxfireDbContext db,
    UserManager<FoxfireUser> users,
    EmailOutbox outbox,
    IIdentityContext me,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time,
    ILogger<CreateInviteRequestHandler> logger)
    : IValidatedRequestHandler<CreateInviteRequest, InviteResponse>
{
    public async Task<Response<InviteResponse>> Handle(
        CreateInviteRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
        var now = time.GetUtcNow();

        // An address with an account can never register again, so an invite
        // to it would only reach somebody who cannot use it. Refused before
        // anything is saved or queued, naming who it belongs to — an admin is
        // allowed to know who their members are.
        if (email is not null && await users.FindByEmailAsync(email) is { } member)
        {
            logger.LogInformation(
                "{Actor} tried to invite {Email}, which is already {Username}'s", me.Username, email, member.UserName);

            var disabled = PasswordResetLookup.IsDisabled(member, now)
                ? " Their account is disabled; turn it back on from Members."
                : "";

            return Response<InviteResponse>.Failure(
                new Error("email_taken", $"That address belongs to {member.UserName}, who is already a member.{disabled}"),
                HttpStatusCode.Conflict);
        }

        // An outstanding invite for this address is handed back rather than
        // duplicated. An admin who cannot remember whether they already sent one
        // should get the same link again, not a second one that quietly
        // invalidates nothing and confuses both of them.
        //
        // Invites without an address are never merged: each is a link for a
        // different somebody, and asking twice means two people.
        if (email is not null)
        {
            var existing = await db.Invites
                .Include(i => i.RedeemedBy)
                .Where(i => i.Email == email && i.RedeemedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
                .OrderByDescending(i => i.CreatedAt)
                .FirstOrDefaultAsync(cancellationToken);

            if (existing is not null)
            {
                return (await InviteLookup.DescribeWithMailAsync(
                    [existing], db, outbox.IsEnabled, server.Value, auth.Value, now, cancellationToken))[0];
            }
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

        // Saved with the invite, so the two stand or fall together. Standard
        // mail: invites are what an admin makes in batches, and they must not
        // use up what a locked-out member's reset needs.
        if (email is not null)
        {
            await outbox.AddAsync(
                EmailKinds.Invite,
                EmailPriority.Standard,
                email,
                relatedId: invite.Id,
                userId: null,
                triggeredBy: me.UserId,
                worthlessAfter: invite.ExpiresAt,
                cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);

        if (email is null)
        {
            logger.LogInformation("{Actor} created invite {InviteId} for whoever opens the link", me.Username, invite.Id);
        }
        else
        {
            logger.LogInformation("{Actor} created invite {InviteId} for {Email}", me.Username, invite.Id, email);
        }

        return (await InviteLookup.DescribeWithMailAsync(
            [invite], db, outbox.IsEnabled, server.Value, auth.Value, now, cancellationToken))[0];
    }
}
