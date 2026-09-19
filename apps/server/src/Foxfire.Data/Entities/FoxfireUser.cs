using Microsoft.AspNetCore.Identity;

namespace Foxfire.Data.Entities;

/// <summary>
/// A person with an account on this server.
///
/// Identity supplies the parts that are dangerous to write yourself — password
/// hashing and its iteration count, the email-confirmation and password-reset
/// token protectors, lockout accounting — so this adds almost nothing to it.
///
/// Username and email are separate on purpose. You log in with your email,
/// because that is the thing you cannot forget and the thing a reset has to be
/// sent to anyway. Your username is what everybody else sees next to your games,
/// and it is yours to pick — first come, first served.
///
/// Both are unique. The email because RequireUniqueEmail is set; the username
/// because Identity indexes NormalizedUserName uniquely by default. Everything
/// on a Foxfire server is visible to every member, so a username is how people
/// tell each other apart on a match row, and letting two of them collide would
/// cost more than it saves the second person to register.
///
/// There is no IsDisabled flag. Disabling somebody is Identity's lockout with no
/// end date, which is already what SignInManager consults on every attempt; a
/// second boolean beside it would be a second answer to the same question, and
/// the two would eventually disagree.
/// </summary>
public sealed class FoxfireUser : IdentityUser<Guid>
{
    /// <summary>When they registered. Shown in the admin user list.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Riot accounts this person has claimed. Empty is normal and fine.</summary>
    public ICollection<RiotAccount> RiotAccounts { get; } = [];
}

/// <summary>Role names, spelled once.</summary>
public static class FoxfireRoles
{
    /// <summary>
    /// May manage users, invites, the public-signup switch, and the data
    /// import — and may force-unlink a Riot account, which is the escape hatch
    /// that makes first-claim-wins survivable.
    /// </summary>
    public const string Admin = "Admin";

    /// <summary>Every role this server knows about.</summary>
    public static readonly IReadOnlyList<string> All = [Admin];
}
