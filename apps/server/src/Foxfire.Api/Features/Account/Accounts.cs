using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// The things somebody can change about their own account, and what they have
/// in common.
///
/// Separate from Features/Auth, which is about starting and keeping a session.
/// These are about the account behind it, and they are all written the same
/// way: find who is asking, make them prove it where it matters, hand the work
/// to Identity, and turn whatever Identity says into a code the clients already
/// know how to read.
/// </summary>
internal static class Accounts
{
    /// <summary>The account making this request, or null if the token names one that is gone.</summary>
    public static async Task<FoxfireUser?> SignedInAsync(UserManager<FoxfireUser> users, IIdentityContext me)
    {
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(me);

        return me.UserId is { } id ? await users.FindByIdAsync(id.ToString()) : null;
    }

    /// <summary>
    /// 401, not 404. The route already required a session, so arriving here
    /// means the session names somebody the database no longer has — deleted
    /// while they had the app open — and the honest answer is to sign in again.
    /// </summary>
    public static Response<TData> SignedOut<TData>() =>
        Response<TData>.Failure(
            new Error("unauthenticated", "That account is no longer on this server. Sign in again."),
            HttpStatusCode.Unauthorized);

    /// <summary>Wrong current password. One code, whichever field was being changed.</summary>
    public static Error WrongPassword =>
        new("wrong_password", "That is not your current password.");

    /// <summary>
    /// Identity's own sentences, under a code the client can switch on.
    ///
    /// The descriptions are worth passing through rather than replacing: the one
    /// that matters here is the password rule, and Identity states its own
    /// length requirement better than a second copy of the number would.
    /// </summary>
    public static Error Refused(IdentityResult result, string code)
    {
        ArgumentNullException.ThrowIfNull(result);
        return new Error(code, string.Join(" ", result.Errors.Select(e => e.Description)));
    }

    /// <summary>Whether an address is the one this server's configuration calls its admin.</summary>
    public static bool IsConfiguredAdmin(string? email, string? configured) =>
        !string.IsNullOrWhiteSpace(email)
        && !string.IsNullOrWhiteSpace(configured)
        && string.Equals(email.Trim(), configured.Trim(), StringComparison.OrdinalIgnoreCase);
}
