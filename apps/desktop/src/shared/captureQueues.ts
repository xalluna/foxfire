import { QUEUE_FILTER_OPTIONS, type QueueFilterOption } from '@foxfire/core'

/**
 * Which queues game capture records.
 *
 * Desktop-only, and split out of the queue rules in @foxfire/core for that
 * reason: recording is something this machine does, and nothing that renders
 * match history — here or in a browser — has any use for it. Built on the same
 * option list so the two controls keep offering the same queues under the same
 * names.
 */

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
