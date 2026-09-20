using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;

namespace Foxfire.Api.Sync;

/// <summary>
/// The cosmetic half of an account: its profile icon, its level, and Riot's
/// summoner id.
///
/// Separate from RankRecorder because it answers a different question with a
/// different lifetime — rank moves every game and is kept as history, while an
/// icon is one current value nobody plots. Fetched in the same places for the
/// same reason the Riot client's own comment gives: it is worth a request only
/// alongside one somebody already needed.
///
/// Until this existed these three columns were written by nothing at all. They
/// were on the entity, on the wire, and rendered by the desktop — which drew an
/// empty frame where every account's icon belongs, on every server, because the
/// only summoner-v4 call in the codebase was the one ad-hoc search makes and
/// stores nothing from.
/// </summary>
public sealed class AccountProfile(FoxfireDbContext db, RiotClient riot, TimeProvider time)
{
    /// <summary>
    /// Brings an account's icon and level up to date, if Riot will say.
    ///
    /// Best-effort: the caller has either just linked an account or just
    /// finished syncing one, and neither is worth failing over a cosmetic
    /// field. Returns whether anything changed, so a caller that has its own
    /// SaveChanges to do can skip a pointless one.
    /// </summary>
    public async Task<bool> RefreshAsync(
        RiotAccount account,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(account);

        var summoner = await riot.GetSummonerAsync(
            account.Platform, account.Puuid, priority, cancellationToken);

        if (account.ProfileIconId == summoner.ProfileIconId
            && account.SummonerLevel == summoner.SummonerLevel
            && account.SummonerId == summoner.Id)
        {
            return false;
        }

        account.ProfileIconId = summoner.ProfileIconId;
        account.SummonerLevel = summoner.SummonerLevel;
        account.SummonerId = summoner.Id;
        account.UpdatedAt = time.GetUtcNow();

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
