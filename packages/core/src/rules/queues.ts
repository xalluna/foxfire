import type { QueueType } from '../types'
import { GAMES, type GameId } from '../games/registry'
import { LADDERS, laddersOf, ladderOfQueueId } from '../games/ladders'

export interface QueueFilterOption {
  /** null means "no queue predicate" — every stored match. */
  value: number | null
  label: string
}

/**
 * The queues one game's history filter offers, in menu order.
 *
 * Deliberately static rather than derived from stored matches: the options stay
 * in the same position regardless of what has been synced, so the control never
 * reorders itself between visits. A queue with no games renders an empty state
 * rather than disappearing from the list.
 */
export function queueFilterOptions(game: GameId): readonly QueueFilterOption[] {
  return [
    { value: null, label: 'All Queues' },
    ...GAMES[game].queues.filter((q) => q.filter).map((q) => ({ value: q.id, label: q.label }))
  ]
}

/** League's filter, which every surface that predates TFT reads. */
export const QUEUE_FILTER_OPTIONS: readonly QueueFilterOption[] = queueFilterOptions('lol')

/**
 * Ranked Solo/Duo. Mixing queues is what makes champion stats untrustworthy, so
 * every filtered surface opens here rather than on "All Queues".
 */
export const DEFAULT_QUEUE_FILTER: number | null = GAMES.lol.defaultQueueFilter

/**
 * League's ladders: the ones its rank and LP history is tracked for.
 *
 * League's alone, though TFT has ladders too, because everything that reads
 * this was written for League and decides League things with it — which
 * readings the League dashboard shows, which ladders League attribution walks.
 * A screen that means every ladder asks laddersOf for the game it is drawing.
 */
export const TRACKED_QUEUES: readonly QueueType[] = laddersOf('lol')

/** Which ladder a match counts towards, or null for unranked queues. */
export function queueTypeForQueueId(queueId: number | null): QueueType | null {
  return ladderOfQueueId(queueId)
}

/** The queue id whose matches move a given ladder. */
export function queueIdForQueueType(queueType: QueueType): number {
  return LADDERS[queueType].queueId
}

export function isRankedQueue(queueId: number | null): boolean {
  return queueTypeForQueueId(queueId) !== null
}

/** A filter option's label, in whichever game's list holds it. */
export function queueFilterLabel(queueId: number | null): string {
  if (queueId === null) return 'All Queues'
  for (const game of Object.keys(GAMES) as GameId[]) {
    const found = queueFilterOptions(game).find((o) => o.value === queueId)
    if (found) return found.label
  }
  return 'All Queues'
}
