import type { QueueType } from './types'

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

export interface CaptureQueueOption {
  value: number
  label: string
}

/**
 * The queues capture can be switched on for, in menu order.
 *
 * Derived from QUEUE_FILTER_OPTIONS minus its "All Queues" entry rather than
 * listed again, so the two controls can never drift into offering different
 * queues under the same names.
 */
export const CAPTURE_QUEUE_OPTIONS: readonly CaptureQueueOption[] = QUEUE_FILTER_OPTIONS.filter(
  (option): option is QueueFilterOption & { value: number } => option.value !== null
).map(({ value, label }) => ({ value, label }))

/** Whether a queue id is one the settings screen lists by name. */
export function isKnownCaptureQueue(queueId: number | null): boolean {
  return queueId !== null && CAPTURE_QUEUE_OPTIONS.some((option) => option.value === queueId)
}

/**
 * Whether a game in this queue should be recorded.
 *
 * The catch-all covers everything the list does not name — customs, Practice
 * Tool (which reports 0), and whatever rotating mode Riot has running this
 * month — so a new gamemode is not silently missed until the next build. It
 * deliberately does not override an unticked queue: unticking ARAM has to mean
 * ARAM, or the two controls contradict each other.
 *
 * A null queue id means the client never told us, which is the same situation
 * as an unrecognised one and is treated identically.
 */
export function shouldCapture(
  queueId: number | null,
  queues: readonly number[],
  otherQueues: boolean
): boolean {
  if (queueId === null) return otherQueues
  if (queues.includes(queueId)) return true
  return otherQueues && !isKnownCaptureQueue(queueId)
}
