import { GAMES, GAME_IDS, queueFilterOptions, type GameId, type QueueFilterOption } from '@foxfire/core'

/**
 * Which queues game capture records.
 *
 * Desktop-only, and split out of the queue rules in @foxfire/core for that
 * reason: recording is something this machine does, and nothing that renders
 * match history — here or in a browser — has any use for it. Built on the same
 * option lists so the two controls keep offering the same queues under the same
 * names.
 */

export interface CaptureQueueOption {
  value: number
  label: string
}

/** One game's queues, under that game's name, as the settings screen groups them. */
export interface CaptureQueueGroup {
  game: GameId
  label: string
  options: readonly CaptureQueueOption[]
}

/**
 * The queues capture can be switched on for, a group per game, in menu order.
 *
 * Derived from each game's history filter minus its "All Queues" entry rather
 * than listed again, so the two controls can never drift into offering
 * different queues under the same names. TFT's are listed, and like every queue
 * start unticked — recording TFT is somebody's choice to make.
 */
export const CAPTURE_QUEUE_GROUPS: readonly CaptureQueueGroup[] = GAME_IDS.map((game) => ({
  game,
  label: GAMES[game].name,
  options: queueFilterOptions(game)
    .filter((option): option is QueueFilterOption & { value: number } => option.value !== null)
    .map(({ value, label }) => ({ value, label }))
}))

/** Every queue capture can be switched on for, in either game. */
export const CAPTURE_QUEUE_OPTIONS: readonly CaptureQueueOption[] = CAPTURE_QUEUE_GROUPS.flatMap(
  (group) => group.options
)

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
 * The catch-all is League's. A TFT event queue nobody listed is TFT, which is
 * recorded only by ticking TFT's own queues — "other queues" was League's
 * switch before there was TFT, and turning it on did not mean recording TFT.
 *
 * A null queue id means the client never told us, which is the same situation
 * as an unrecognised one and is treated identically.
 */
export function shouldCapture(
  queueId: number | null,
  queues: readonly number[],
  otherQueues: boolean,
  game: GameId = 'lol'
): boolean {
  if (queueId !== null && queues.includes(queueId)) return true
  if (game === 'tft') return false
  if (queueId === null) return otherQueues
  return otherQueues && !isKnownCaptureQueue(queueId)
}
