import { recordLcuEvent } from './index'
import { describeError } from './redact'

/**
 * League client telemetry.
 *
 * The watcher polls loopback every 10s connected / 30s idle, forever, including
 * in tray mode — roughly 8,600 successful polls a day, nearly all of them
 * saying "still fine". Recording every one would bury the Riot data in noise
 * for no benefit, so successful polls are sampled at most once a minute while
 * transitions and errors are always kept.
 *
 * The errors matter most: watcher.ts swallows them on purpose, because a client
 * that closes mid-poll is normal and not worth telling the user about. That is
 * the right product behaviour and the reason the failure mode has been
 * invisible until now.
 */

const POLL_SAMPLE_INTERVAL_MS = 60_000

let lastPollSampleAt = 0
let lastState: string | null = null

export function recordLcuTransition(state: string, detail?: string): void {
  if (state === lastState) return
  lastState = state
  recordLcuEvent({
    occurredAt: Date.now(),
    kind: state === 'connected' ? 'connected' : 'disconnected',
    latencyMs: null,
    detail: detail ?? state
  })
}

export function recordLcuPoll(latencyMs: number): void {
  const now = Date.now()
  if (now - lastPollSampleAt < POLL_SAMPLE_INTERVAL_MS) return
  lastPollSampleAt = now
  recordLcuEvent({ occurredAt: now, kind: 'poll', latencyMs, detail: null })
}

export function recordLcuError(err: unknown): void {
  const described = describeError(err)
  recordLcuEvent({
    occurredAt: Date.now(),
    kind: 'error',
    latencyMs: null,
    detail: `${described.kind}: ${described.message}`
  })
}
