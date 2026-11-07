/**
 * Durations and sizes, the way a telemetry panel writes them — the desktop's
 * own, and a server's insights page. Null is a dash: nothing was measured.
 */

import { format, isSameDay, isSameMonth } from 'date-fns'

export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms === 0) return '0ms'
  if (ms < 1) return '<1ms'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * The days a stretch of time covers, as briefly as reads clearly: "Oct 4",
 * "Oct 10 – 18", "Sep 28 – Oct 3". Local time, as every date on screen is.
 */
export function formatDayRange(from: number, to: number): string {
  if (isSameDay(from, to)) return format(from, 'MMM d')
  if (isSameMonth(from, to)) return `${format(from, 'MMM d')} – ${format(to, 'd')}`
  return `${format(from, 'MMM d')} – ${format(to, 'MMM d')}`
}

/** How long something has been running: the two largest units that say anything. */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${Math.max(0, Math.floor(seconds))}s`
}
