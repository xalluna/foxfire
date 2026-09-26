import type { TelemetryOutcome } from '@shared/telemetry'

/**
 * Shared formatting for the telemetry panel, where everything is a duration, a size, or a status.
 * Durations and sizes are @foxfire/ui's, which a server's insights page writes them with too.
 */

export { formatBytes, formatMs } from '@foxfire/ui'

export function formatClock(at: number): string {
  const d = new Date(at)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export type Tone = 'ok' | 'warn' | 'error' | 'mute'

/**
 * 429 is deliberately a warning rather than an error: being throttled means the
 * limiter is doing its job at the ceiling, and the request is retried. A 404 is
 * also not an error here — several callers treat it as a valid empty result.
 */
export function outcomeTone(outcome: TelemetryOutcome, status: number | null): Tone {
  if (outcome === 'ok') return 'ok'
  if (status === 429) return 'warn'
  if (status === 404) return 'mute'
  return 'error'
}

export const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-teal',
  warn: 'text-amber',
  error: 'text-red',
  mute: 'text-text-mute'
}

export const TONE_CHIP: Record<Tone, string> = {
  ok: 'border-teal/30 bg-teal/10 text-teal',
  warn: 'border-amber/40 bg-amber/10 text-amber',
  error: 'border-red/40 bg-red/10 text-red',
  mute: 'border-hairline bg-canvas text-text-mute'
}

/** Trims the common Riot prefix so the distinguishing part of a template fits a column. */
export function shortEndpoint(endpoint: string): string {
  return endpoint.replace(/^\/lol\//, '').replace(/^\/riot\//, '')
}

export const WINDOW_OPTIONS = [
  { label: '5m', ms: 5 * 60_000 },
  { label: '30m', ms: 30 * 60_000 },
  { label: '2h', ms: 2 * 60 * 60_000 },
  { label: '12h', ms: 12 * 60 * 60_000 },
  { label: '48h', ms: 48 * 60 * 60_000 }
] as const
