import type { DatabaseSync } from 'node:sqlite'
import { getRankedMatchesBetween, upsertMatchRank } from '../db/repositories/rankHistory.repo'
import { rankMovement } from '@shared/ladder'
import { queueIdForQueueType } from '@shared/queues'
import type { QueueType, RankSnapshot } from '@shared/types'

/**
 * Assigns an LP change to a game, but only when it is unambiguous.
 *
 * Riot publishes no per-match LP, so all this can do is attribute the movement
 * between two snapshots. When exactly one ranked game falls in that interval,
 * the delta is that game's, exactly. When several do, the total could have been
 * split between them any number of ways, and nothing is written rather than
 * spreading a guess across games and presenting it as a measurement.
 *
 * Kept free of getDb() so it can be tested against an in-memory database —
 * importing the app's db module would pull in Electron.
 *
 * Returns true when a row was written.
 */
export function attributeInterval(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  queueType: QueueType,
  before: RankSnapshot,
  after: RankSnapshot
): boolean {
  if (before.ladderPosition === null || after.ladderPosition === null) return false

  const matches = getRankedMatchesBetween(
    db,
    puuid,
    queueIdForQueueType(queueType),
    before.capturedAt,
    after.capturedAt
  )
  if (matches.length !== 1) return false

  const movement = rankMovement(before, after)

  upsertMatchRank(db, {
    matchId: matches[0].matchId,
    accountId,
    queueType,
    tierBefore: before.tier,
    rankBefore: before.rank,
    lpBefore: before.leaguePoints,
    tierAfter: after.tier,
    rankAfter: after.rank,
    lpAfter: after.leaguePoints,
    // Ladder positions rather than raw LP, so the delta stays correct across a
    // division or tier boundary where LP itself wraps back around to near zero.
    lpDelta: after.ladderPosition - before.ladderPosition,
    isPromotion: movement === 'promotion',
    isDemotion: movement === 'demotion'
  })

  return true
}
