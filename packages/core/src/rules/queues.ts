import type { QueueType } from '../types'

export interface QueueFilterOption {
  /** null means "no queue predicate" — every stored match. */
  value: number | null
  label: string
}

/**
 * The queues offered by the filter, in menu order.
 *
 * Deliberately static rather than derived from stored matches: the options stay
 * in the same position regardless of what has been synced, so the control never
 * reorders itself between visits. A queue with no games renders an empty state
 * rather than disappearing from the list.
 */
export const QUEUE_FILTER_OPTIONS: readonly QueueFilterOption[] = [
  { value: null, label: 'All Queues' },
  { value: 420, label: 'Ranked Solo/Duo' },
  { value: 440, label: 'Ranked Flex' },
  { value: 400, label: 'Normal Draft' },
  { value: 430, label: 'Normal Blind' },
  { value: 450, label: 'ARAM' },
  { value: 1700, label: 'Arena' }
]

/**
 * Ranked Solo/Duo. Mixing queues is what makes champion stats untrustworthy, so
 * every filtered surface opens here rather than on "All Queues".
 */
export const DEFAULT_QUEUE_FILTER: number | null = 420

/** The only two queues that carry an LP ladder; everything else has no rank. */
const QUEUE_ID_TO_QUEUE_TYPE: Record<number, QueueType> = {
  420: 'RANKED_SOLO_5x5',
  440: 'RANKED_FLEX_SR'
}

/** The ranked ladders this app tracks rank and LP history for. */
export const TRACKED_QUEUES: readonly QueueType[] = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']

/** Which ladder a match counts towards, or null for unranked queues. */
export function queueTypeForQueueId(queueId: number | null): QueueType | null {
  return queueId === null ? null : (QUEUE_ID_TO_QUEUE_TYPE[queueId] ?? null)
}

/** The queue id whose matches move a given ladder. */
export function queueIdForQueueType(queueType: QueueType): number {
  return queueType === 'RANKED_SOLO_5x5' ? 420 : 440
}

export function isRankedQueue(queueId: number | null): boolean {
  return queueTypeForQueueId(queueId) !== null
}

export function queueFilterLabel(queueId: number | null): string {
  return QUEUE_FILTER_OPTIONS.find((o) => o.value === queueId)?.label ?? 'All Queues'
}
