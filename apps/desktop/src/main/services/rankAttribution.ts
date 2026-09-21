import type { DatabaseSync } from 'node:sqlite'
import {
  getRankSnapshots,
  getRankedMatchesBetween,
  upsertMatchRank
} from '../db/repositories/rankHistory.repo'
import { listSeasons } from '../db/repositories/seasons.repo'
import { rankMovement, queueIdForQueueType, TRACKED_QUEUES, resetsBetween } from '@foxfire/core'
import type { QueueType, RankSnapshot, Season } from '@shared/types'

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
  after: RankSnapshot,
  seasons: Season[] = []
): boolean {
  if (before.ladderPosition === null || after.ladderPosition === null) return false

  // Never attribute across a ladder reset. The interval from a December reading
  // to the first January one holds the annual reset, and its ladder delta is
  // the entire height of the player's rank — roughly -1,900 for a Diamond
  // player. If a single ranked game happens to sit in that interval it would be
  // handed that number as its LP change, and because replayAttribution reruns
  // unbounded on every launch, the chip would come back every time it was
  // cleared. The reset is not a result of any game, so no game gets it.
  //
  // Keyed on the reset rather than on the season boundary: a preseason carries
  // rank forward, and a game either side of a boundary that reset nothing still
  // earned its LP. With no seasons recorded this guard cannot fire — that is
  // the cost of the boundaries being hand-entered, and why the editor seeds
  // one rather than starting empty.
  if (resetsBetween(seasons, before.capturedAt, after.capturedAt)) return false

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

/**
 * How far back a routine replay reaches.
 *
 * A cost control rather than a guarantee: it keeps a sync from walking years of
 * snapshots while still covering everything recent enough to still be arriving.
 * The rank view can now ask for a whole ranked year, which is wider than this —
 * what actually backstops the rest is repairAttribution, which runs unbounded
 * once per launch. A full repair passes null instead.
 */
export const ATTRIBUTION_REPLAY_WINDOW_MS = 30 * 86_400_000

/**
 * Re-runs attribution across every stored interval, and the reason the LP chip
 * works at all.
 *
 * Attribution used to happen once, inline, the moment a snapshot was written —
 * which is roughly a minute after the game ends, and Riot does not publish a
 * match to match-v5 for a couple of minutes after that. So the interval was
 * always searched before the match it contained existed locally, found nothing,
 * and was never revisited: the snapshot had already moved the boundary past the
 * game, and a later sync storing the match changed no rank value, so nothing
 * re-triggered. Every game came out unattributed.
 *
 * Replaying decouples the two arrival orders. Whichever lands second — the
 * snapshot or the match — the next sync closes the gap, which also backfills
 * history recorded before this existed.
 *
 * No "already done" bookkeeping: attributeInterval writes only when an interval
 * holds exactly one game, and upsertMatchRank is idempotent, so re-running is
 * safe and can only ever add information.
 *
 * Returns the number of intervals that wrote a row.
 */
export function replayAttribution(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  sinceMs: number | null = null
): number {
  // Loaded once rather than per interval: this walks every stored snapshot pair
  // for both ladders, and the list is a handful of rows that cannot change
  // mid-replay.
  const seasons = listSeasons(db)
  let attributed = 0

  for (const queueType of TRACKED_QUEUES) {
    const snapshots = getRankSnapshots(db, accountId, queueType, sinceMs)
    for (let i = 1; i < snapshots.length; i++) {
      const wrote = attributeInterval(
        db,
        accountId,
        puuid,
        queueType,
        snapshots[i - 1],
        snapshots[i],
        seasons
      )
      if (wrote) attributed++
    }
  }

  return attributed
}
