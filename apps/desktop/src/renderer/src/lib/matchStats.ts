import type { MatchSummary } from '@shared/types'

/**
 * Derived match numbers.
 *
 * Everything here is arithmetic over stats Riot actually measured — there is
 * deliberately no composite "performance rating". A single invented number
 * would imply a precision this data can't support, so the UI shows the real
 * components and lets the reader judge.
 */

/** Riot reports a deathless game as an infinite ratio; the UI names it instead. */
export function kdaRatio(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return 'Perfect'
  return ((kills + assists) / deaths).toFixed(2)
}

/**
 * Any total over its playtime — CS/min, damage/min.
 *
 * Rates rather than raw totals because game length varies enough to swamp the
 * difference between players: a farmed-out 40-minute game and a 20-minute stomp
 * produce very different totals from identical play.
 */
export function perMinute(total: number | null, durationSeconds: number): number | null {
  if (total === null || durationSeconds <= 0) return null
  return total / (durationSeconds / 60)
}

/** Share of the team's kills the player took part in. Null when the team was shut out. */
export function killParticipation(match: MatchSummary): number | null {
  if (match.teamKills <= 0) return null
  return (match.kills + match.assists) / match.teamKills
}

/** Share of the team's champion damage dealt by the player. */
export function damageShare(match: MatchSummary): number | null {
  if (match.teamDamage <= 0 || match.damageDealtToChampions === null) return null
  return match.damageDealtToChampions / match.teamDamage
}

const MULTI_KILL_LABELS: Record<number, string> = {
  2: 'Double Kill',
  3: 'Triple Kill',
  4: 'Quadra Kill',
  5: 'Penta Kill'
}

/** Null for 0 and 1 — a single kill is not an achievement worth a badge. */
export function multiKillLabel(largestMultiKill: number | null): string | null {
  if (largestMultiKill === null) return null
  return MULTI_KILL_LABELS[largestMultiKill] ?? null
}

export function formatPercent(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`
}

/** 18_900 → "18.9k"; keeps damage columns to a fixed width. */
export function compactNumber(value: number | null): string {
  if (value === null) return '—'
  if (value < 1000) return String(value)
  return `${(value / 1000).toFixed(1)}k`
}

export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/**
 * "6h ago", "3d ago" — deliberately terser than date-fns.
 *
 * The match row shares one narrow column between duration and age, and
 * date-fns's "about 6 hours ago" overruns it at every plausible width.
 */
export function formatAge(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)

  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < MONTH) return `${Math.floor(elapsed / DAY)}d ago`
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)}mo ago`
  return `${Math.floor(elapsed / YEAR)}y ago`
}
