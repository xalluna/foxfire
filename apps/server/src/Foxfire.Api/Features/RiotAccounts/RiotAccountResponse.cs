using Foxfire.Data.Entities;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// A League account as anybody on this server sees it.
///
/// Deliberately a superset of the shape the desktop already calls an Account,
/// so the screens that draw one need no translation layer and no second type.
/// The three fields beyond it — the owner, their name, and whether it is the
/// caller's — are what a shared server adds to the idea of an account.
/// </summary>
/// <param name="Puuid">
/// Riot's encrypted player id, under *this server's* key.
///
/// Sent because the match detail screen highlights the tracked player by it,
/// and every participant row it compares against came from this same server, so
/// within that data it is a working key. It means nothing anywhere else, and
/// nothing outside this server should be handed it expecting otherwise.
/// </param>
/// <param name="IsHomeAccount">
/// Always false here. Which account a machine opens on is a preference
/// belonging to that machine, and a server answering it would be answering for
/// everybody signed in to it — the desktop keeps its own.
/// </param>
/// <param name="OwnerUsername">Who has claimed it, or null for unclaimed.</param>
/// <param name="IsMine">Whether the caller may edit LP for it.</param>
public sealed record RiotAccountResponse(
    Guid Id,
    string Puuid,
    string GameName,
    string TagLine,
    string RiotId,
    string Platform,
    string RegionalRoute,
    string? SummonerId,
    int? ProfileIconId,
    long? SummonerLevel,
    bool IsHomeAccount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    Guid? OwnerId,
    string? OwnerUsername,
    bool IsMine,
    DateTimeOffset? LinkedAt)
{
    /// <summary>
    /// One League account, as the caller sees it.
    ///
    /// Shared with the dashboard rather than described twice: both answer the
    /// same question about the same row, and two copies would eventually
    /// disagree about what IsMine means.
    /// </summary>
    public static RiotAccountResponse Describe(RiotAccount account, Guid? me)
    {
        ArgumentNullException.ThrowIfNull(account);

        return new RiotAccountResponse(
            account.Id,
            account.Puuid,
            account.GameName,
            account.TagLine,
            account.RiotId,
            account.Platform,
            account.RegionalRoute,
            account.SummonerId,
            account.ProfileIconId,
            account.SummonerLevel,
            IsHomeAccount: false,
            account.CreatedAt,
            account.UpdatedAt,
            account.OwnerId,
            account.Owner?.UserName,
            IsMine: me is not null && account.OwnerId == me,
            account.LinkedAt);
    }
}
