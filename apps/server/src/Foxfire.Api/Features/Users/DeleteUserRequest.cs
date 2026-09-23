using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Users;

/// <summary>
/// Removes somebody from the server.
///
/// What goes with them is only theirs: their sessions, any reset link aimed at
/// their account, and their claim on any League accounts, which return to
/// unclaimed. What stays is everything shared — the matches, and the record of
/// which invite let them in, because a spent invite must not become usable
/// again just because the account it made is gone.
/// </summary>
public sealed record DeleteUserRequest(Guid Id) : IEmptyDomainRequest;

internal sealed class DeleteUserRequestHandler(
    UserManager<FoxfireUser> users,
    FoxfireDbContext db,
    ILogger<DeleteUserRequestHandler> logger)
    : IDomainRequestHandler<DeleteUserRequest>
{
    public async Task<Response> Handle(DeleteUserRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await users.FindByIdAsync(request.Id.ToString());
        if (user is null) return Response.NotFound();

        if (await Administrators.IsLastAsync(db, request.Id, cancellationToken))
        {
            return Response.Failure(Administrators.Last("delete"), Administrators.LastStatus);
        }

        // By hand, because the foreign key from an invite to who redeemed it is
        // NO ACTION at the database level — SQL Server refuses two cascading
        // paths between the same pair of tables and the created-by key already
        // has the one. Clear the reference or the delete is refused.
        await db.Invites
            .Where(i => i.RedeemedByUserId == request.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.RedeemedByUserId, (Guid?)null), cancellationToken);

        // The same again for the reset links this admin made for other people.
        // The resets aimed at their own account go with them, by cascade.
        await db.PasswordResets
            .Where(r => r.CreatedByUserId == request.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.CreatedByUserId, (Guid?)null), cancellationToken);

        var deleted = await users.DeleteAsync(user);
        if (!deleted.Succeeded)
        {
            return new Error("delete_failed", string.Join(" ", deleted.Errors.Select(e => e.Description)));
        }

        logger.LogWarning("Deleted the account {Username}", user.UserName);
        return Response.Success();
    }
}
