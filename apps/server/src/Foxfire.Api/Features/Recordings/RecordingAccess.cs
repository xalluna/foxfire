using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>Whether an account played a game, which a recording of it has to be the account's view of.</summary>
public sealed class RecordingAccess(FoxfireDbContext db, TftIdentity tftIdentity, ServerGames games)
{
    public static Error NotInMatch { get; } =
        new("not_in_match", "That account is not in that game on this server.");

    /// <summary>
    /// On either game's board: League's by the account's puuid, TFT's by its
    /// puuid under TFT's key, which is the same one unless the server has a TFT
    /// key of its own. TFT's only while this server offers it.
    /// </summary>
    public async Task<bool> PlayedAsync(RiotAccount account, string matchId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(account);

        if (await db.MatchParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == account.Puuid, cancellationToken))
        {
            return true;
        }

        var tftPuuid = games.Tft ? await tftIdentity.KnownPuuidAsync(account, cancellationToken) : null;
        return tftPuuid is not null && await db.TftParticipants
            .AnyAsync(p => p.MatchId == matchId && p.Puuid == tftPuuid, cancellationToken);
    }
}
