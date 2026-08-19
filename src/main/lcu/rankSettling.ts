import type { QueueType } from '@shared/types'

/**
 * When a rank reading taken just after a game can be trusted to be the real one.
 *
 * The client does not update /lol-ranked/v1/current-ranked-stats at the moment a
 * game ends. For a few seconds after the gameflow reaches an end phase the
 * endpoint still serves the rank the player went *in* with, and only then
 * catches up. The watcher polls every ten seconds, so the tick that notices the
 * game ended routinely reads the stale value.
 *
 * On its own that would be harmless — the next poll records the real number.
 * What made it lossy was forcing a snapshot on that tick, which the watcher did
 * so that a game genuinely worth no LP still closed its interval (see `force` in
 * recordRankSnapshot). Forcing on a stale reading stores the pre-game LP under a
 * post-game timestamp, and that is the worst of both: attribution brackets the
 * game with two identical readings and records 0 LP, while the real movement
 * falls into the ten-second interval that follows, which contains no game at all
 * and so is discarded. The game keeps the 0 permanently.
 *
 * A stale reading and a game that really moved no LP are indistinguishable at
 * the instant the game ends — both say "unchanged". The only thing that tells
 * them apart is time, so the force is deferred rather than dropped: the ordinary
 * "value moved" path is given a window to record a real change, and only if the
 * reading is still unchanged when that window closes is it believed and written.
 *
 * Kept apart from watcher.ts, and free of Electron and the database, for the
 * same reason gameflow.ts is: reproducing this by hand means playing a ranked
 * game and waiting to see which way the client lies.
 */

/**
 * How long an unchanged post-game reading is given before it is believed.
 *
 * Bounded from both directions. Long enough to cover a slow client — the lag
 * seen in practice is a single poll, and this allows six. Short enough that the
 * forced snapshot still lands well before the next game could be created, which
 * is the whole reason the force exists; the fastest route back into a game runs
 * through champion select and takes several minutes.
 */
export const RANK_SETTLE_MS = 60_000

/** A finished ranked game whose LP reading has not yet been believed. */
export interface PendingRankReading {
  /** The ladder it was played on. Nothing is waited on for the other one. */
  queueType: QueueType
  /** Epoch ms from which an unchanged reading counts as settled. */
  settledFrom: number
}

/** Opens the window for the ladder a just-finished ranked game was played on. */
export function pendingReadingFor(queueType: QueueType, now: number): PendingRankReading {
  return { queueType, settledFrom: now + RANK_SETTLE_MS }
}

/**
 * Whether this queue's snapshot should now be written even though the reading
 * has not moved.
 *
 * Scoped to the queue the game was actually played on. "A ranked game ended"
 * used to force every tracked ladder, which writes a duplicate row on the other
 * one — and a duplicate row closes whatever interval was open there at a value
 * nothing ever measured, costing an unattributed flex game its LP because a solo
 * game finished.
 */
export function isSettled(
  pending: PendingRankReading | null,
  queueType: QueueType,
  now: number
): boolean {
  return pending !== null && pending.queueType === queueType && now >= pending.settledFrom
}
