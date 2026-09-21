import type { DatabaseSync } from 'node:sqlite'
import {
  deleteManualSnapshot,
  deleteMatchRankForQueue,
  getManualSnapshotQueueType,
  getManualSnapshots,
  getSnapshotBefore,
  getEditableRankedMatches,
  insertManualSnapshot,
  type SnapshotInput
} from '../db/repositories/rankHistory.repo'
import { replayAttribution } from './rankAttribution'
import { ALL_TIERS, APEX_TIERS, DIVISIONS, queueIdForQueueType } from '@foxfire/core'
import type { EditableMatch, ManualRank, ManualRankEdit, QueueType } from '@shared/types'

/**
 * Hand-entered LP, for the games attribution cannot work out on its own.
 *
 * Everything here writes rank_snapshots and never match_rank. Snapshots are what
 * the graph plots and what attribution derives from, so one row written at a
 * game's end time gives the LP chip, the crest, the milestones and the graph at
 * once — and because replayAttribution recomputes the same answer from it every
 * run, an entry needs no protection from being overwritten.
 *
 * Kept free of getDb() so it can be tested against an in-memory database, the
 * same reason rankAttribution is.
 */

/**
 * When the user's assertion is taken to have been true.
 *
 * Game end rather than game start, so it falls inside the
 * `game_creation > after AND <= upTo` window for its own match and clear of the
 * next one. game_duration is seconds, unlike every other time in this schema.
 */
export function manualSnapshotTime(gameCreation: number, gameDuration: number): number {
  return gameCreation + gameDuration * 1000
}

/**
 * A moment just before a game, for the rare entry that must state the rank
 * going in as well as the one coming out. A millisecond is enough: the interval
 * test is a strict `>`, so the game still falls inside it.
 */
function beforeSnapshotTime(gameCreation: number): number {
  return gameCreation - 1
}

const APEX = APEX_TIERS as readonly string[]

/**
 * Rejects a rank that could not exist, before it reaches the database.
 *
 * ladderPosition returns null for anything it cannot place, and a snapshot with
 * a null position is silently skipped by attribution — so an unchecked bad
 * value would save without error and then do nothing, which is the most
 * confusing outcome available. IPC arguments are otherwise only cast, not
 * validated, but a stored rank outlives the call that wrote it.
 */
export function validateManualRank(rank: ManualRank): string | null {
  if (!(ALL_TIERS as readonly string[]).includes(rank.tier)) return 'Pick a tier'

  if (APEX.includes(rank.tier)) {
    // Master and above are ranked by ladder cutoffs, so LP runs past 100 with
    // no divisions to cross.
    if (!Number.isInteger(rank.leaguePoints) || rank.leaguePoints < 0) {
      return 'LP must be 0 or more'
    }
    return null
  }

  if (!rank.rank || !(DIVISIONS as readonly string[]).includes(rank.rank)) return 'Pick a division'
  if (!Number.isInteger(rank.leaguePoints) || rank.leaguePoints < 0 || rank.leaguePoints > 99) {
    return 'LP must be between 0 and 99'
  }
  return null
}

/** Apex tiers have no divisions; Riot reports them as "I" and the ladder ignores it. */
function toSnapshotInput(queueType: QueueType, rank: ManualRank): SnapshotInput {
  return {
    queueType,
    tier: rank.tier,
    rank: APEX.includes(rank.tier) ? 'I' : rank.rank,
    leaguePoints: rank.leaguePoints,
    // Unknown for an assertion, and nothing reads a snapshot's win/loss counts.
    wins: null,
    losses: null
  }
}

/**
 * Rebuilds every LP figure on one ladder from the snapshots that remain.
 *
 * upsertMatchRank corrects and inserts but never deletes, so removing an entry
 * would otherwise strand the row it produced — attribution would find the
 * interval ambiguous again, write nothing, and the stale value would sit there
 * looking measured. Clearing first makes every manual mutation a rebuild, which
 * is lossless because match_rank holds nothing not derived from snapshots.
 *
 * The replay is unbounded rather than the routine 30-day window: an entry can
 * be made against a game of any age, and a windowed replay would simply never
 * reach it.
 */
export function rebuildAttribution(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  queueType: QueueType
): void {
  deleteMatchRankForQueue(db, accountId, queueType)
  replayAttribution(db, accountId, puuid, null)
}

/**
 * The games the editor can offer, oldest first.
 *
 * `beforeUsable` is the interesting field: attributeInterval bails when the
 * preceding reading has no ladder position, so for the first tracked game — or
 * one following a placement — an after state alone would save and then produce
 * nothing. Those rows collect the before state too.
 */
export function getEditableMatches(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  queueType: QueueType
): EditableMatch[] {
  const matches = getEditableRankedMatches(db, accountId, puuid, queueIdForQueueType(queueType))

  const entries = getManualSnapshots(db, accountId, queueType)

  return matches.map((match) => {
    // A game can carry two entries; the one after its start is the after state.
    const manual =
      entries.find((e) => e.matchId === match.matchId && e.capturedAt > match.gameCreation) ?? null
    const ownBefore =
      entries.find((e) => e.matchId === match.matchId && e.capturedAt < match.gameCreation) ?? null

    const previous = getSnapshotBefore(db, accountId, queueType, match.gameCreation)

    return {
      ...match,
      before:
        ownBefore?.rank ??
        (previous?.tier
          ? {
              tier: previous.tier,
              rank: previous.rank,
              leaguePoints: previous.leaguePoints ?? 0
            }
          : null),
      beforeAt: previous?.capturedAt ?? null,
      beforeUsable: previous !== null && previous.ladderPosition !== null,
      manual: manual?.rank ?? null
    }
  })
}

/**
 * Stores a batch of entries and rebuilds the ladder's LP in one transaction.
 *
 * Batched because entries interact: stating the rank after two games of a run
 * of three splits it into three single-game intervals, and the third resolves
 * on its own. Replaying once at the end rather than per row means the list the
 * user gets back already reflects that.
 */
export function saveManualRanks(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  queueType: QueueType,
  edits: ManualRankEdit[]
): void {
  const matches = new Map(
    getEditableRankedMatches(db, accountId, puuid, queueIdForQueueType(queueType)).map((m) => [
      m.matchId,
      m
    ])
  )

  for (const edit of edits) {
    if (!matches.has(edit.matchId)) {
      throw new Error(`${edit.matchId} is not a ranked game awaiting an LP figure`)
    }
    const invalid = validateManualRank(edit.after)
    if (invalid) throw new Error(invalid)
    if (edit.before) {
      const invalidBefore = validateManualRank(edit.before)
      if (invalidBefore) throw new Error(invalidBefore)
    }
  }

  db.exec('BEGIN')
  try {
    for (const edit of edits) {
      const match = matches.get(edit.matchId)!
      deleteManualSnapshot(db, accountId, edit.matchId)

      if (edit.before) {
        insertManualSnapshot(
          db,
          accountId,
          edit.matchId,
          toSnapshotInput(queueType, edit.before),
          beforeSnapshotTime(match.gameCreation)
        )
      }

      insertManualSnapshot(
        db,
        accountId,
        edit.matchId,
        toSnapshotInput(queueType, edit.after),
        manualSnapshotTime(match.gameCreation, match.gameDuration)
      )
    }

    rebuildAttribution(db, accountId, puuid, queueType)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Drops the user's entry for one game and rebuilds, returning whether one existed. */
export function clearManualRank(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  matchId: string
): boolean {
  const queueType = getManualSnapshotQueueType(db, accountId, matchId)
  if (!queueType) return false

  db.exec('BEGIN')
  try {
    deleteManualSnapshot(db, accountId, matchId)
    rebuildAttribution(db, accountId, puuid, queueType)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
}
