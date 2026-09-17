import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'
import { app } from 'electron'
import { isTelemetryWindowOpen } from '../telemetryWindow'
import { isTelemetryEnabled, recordResourceSample } from './index'

/**
 * Per-process CPU and memory, plus event-loop delay for the main process.
 *
 * `app.getAppMetrics()` returns every Electron process in one synchronous call,
 * and `monitorEventLoopDelay` is a histogram maintained by libuv that costs
 * essentially nothing to read and reset. Event-loop delay is the signal that
 * matters most here: node:sqlite is synchronous, so a slow write shows up as
 * the main thread stalling rather than as CPU.
 *
 * The cadence adapts because this app runs in the tray indefinitely with no
 * window open. A fixed 1Hz would write ~86,000 rows a day, nearly all of them
 * recording that nothing happened.
 */

const SAMPLE_ACTIVE_MS = 1_000
const SAMPLE_IDLE_MS = 10_000

/** Riot traffic this recently means something is worth watching closely. */
const ACTIVITY_WINDOW_MS = 30_000

let timer: NodeJS.Timeout | null = null
let histogram: IntervalHistogram | null = null
let queueDepth = 0
let peakQueueDepth = 0
let lastDispatchAt = 0

/**
 * Fed by the rate limiter's existing `dispatch` event, which until now had no
 * listeners at all. Doubles as the activity signal for the cadence below —
 * recent dispatches mean a sync or a live-game check is in flight, with no need
 * for this module to know anything about those services.
 */
export function observeDispatch(depth: number): void {
  queueDepth = depth
  peakQueueDepth = Math.max(peakQueueDepth, depth)
  lastDispatchAt = Date.now()
}

function isActive(): boolean {
  return isTelemetryWindowOpen() || Date.now() - lastDispatchAt < ACTIVITY_WINDOW_MS
}

function nsToMs(nanoseconds: number): number {
  return Number((nanoseconds / 1e6).toFixed(2))
}

function sample(): void {
  if (!isTelemetryEnabled()) return

  const sampledAt = Date.now()
  const loop = histogram
  // Read and reset together, so each sample describes the interval since the
  // previous one rather than everything since the process started.
  const loopDelay = loop
    ? {
        mean: nsToMs(loop.mean),
        p99: nsToMs(loop.percentile(99)),
        max: nsToMs(loop.max)
      }
    : null
  loop?.reset()

  const depth = peakQueueDepth
  peakQueueDepth = queueDepth

  for (const metric of app.getAppMetrics()) {
    // Loop delay and queue depth belong to the main process, so they ride on
    // its row and are null everywhere else.
    const isMain = metric.type === 'Browser'
    recordResourceSample({
      sampledAt,
      processType: metric.type,
      pid: metric.pid,
      cpuPercent: round(metric.cpu?.percentCPUUsage ?? null),
      workingSetKb: metric.memory?.workingSetSize ?? null,
      loopDelayMeanMs: isMain ? (loopDelay?.mean ?? null) : null,
      loopDelayP99Ms: isMain ? (loopDelay?.p99 ?? null) : null,
      loopDelayMaxMs: isMain ? (loopDelay?.max ?? null) : null,
      queueDepth: isMain ? depth : null
    })
  }
}

function round(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(2))
}

/**
 * Self-scheduling rather than setInterval so the delay can change between
 * ticks, the same reason the LCU watcher is written this way.
 */
function schedule(): void {
  timer = setTimeout(() => {
    sample()
    if (timer) schedule()
  }, isActive() ? SAMPLE_ACTIVE_MS : SAMPLE_IDLE_MS)
  // Sampling must never be the reason the process stays alive.
  timer.unref?.()
}

export function startResourceSampling(): void {
  if (timer) return
  histogram = monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()
  schedule()
}

export function stopResourceSampling(): void {
  if (timer) clearTimeout(timer)
  timer = null
  histogram?.disable()
  histogram = null
}
