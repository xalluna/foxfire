/**
 * Ranked periods: one calendar year each.
 *
 * Riot publishes no way to ask which ranked season is current. The static
 * seasons.json stopped at SEASON 2019, league-v4 entries carry no season or
 * split field, and match-v5 dropped the seasonId that match-v4 used to send.
 * What is left is the patch number, which went year-based in 2025 — a game on
 * 26.15 is a 2026 game — and the timestamps this app already stores.
 *
 * So a period is simply a calendar year, derived rather than configured. There
 * is no season table, nothing to seed, and nothing to update each January.
 *
 * Riot's own vocabulary is worth keeping straight, because it does not match:
 * a ranked *year* runs January to January and is the only boundary where rank
 * and MMR actually reset, while Riot now calls the three splits inside that
 * year "seasons" (S1, S2, S3), and rank carries across them untouched. The
 * period modelled here is the year — the reset — because that is the boundary
 * where a fresh set of stats is the truthful thing to show.
 *
 * The wins and losses league-v4 reports carry across those inner boundaries
 * too. Measured against stored history over the 2026 S2-to-S3 change on 29
 * July, Riot's figure equalled the games played on both sides of it, exactly.
 * Secondhand write-ups claim that field resets every split; for that change, on
 * those accounts, it did not. So the rank cards keep showing Riot's number —
 * it needs no local history to be complete, which counting stored matches
 * would. Only the annual reset is treated as a boundary anywhere in this app.
 *
 * Lives in shared/ because both sides need it: main turns a period into SQL
 * bind parameters, and the renderer labels the picker with it.
 */

import type { RankRange } from './types'

const DAY_MS = 86_400_000

const SEASON_PREFIX = 'season:'

/** Matches an encoded period exactly, so `season:` alone cannot parse as year 0. */
const SEASON_RANGE = /^season:(\d{4})$/

/** The ranked year a moment belongs to. */
export function seasonOf(ms: number): number {
  return new Date(ms).getFullYear()
}

/**
 * Half-open bounds of a ranked year, as epoch milliseconds.
 *
 * Local midnight rather than UTC. Riot starts a season at noon local *server*
 * time, so neither is exact to the minute, and local is what someone reading
 * the graph expects the year to turn over on. The gap between the two is dead
 * time anyway: ranked queues are closed between the year ending and the new
 * season opening a week later, so nothing can be filed on the wrong side of it.
 *
 * End is exclusive, so consecutive years tile without overlapping on the
 * instant of the boundary itself.
 */
export function seasonBounds(year: number): { startMs: number; endMs: number } {
  return {
    startMs: new Date(year, 0, 1).getTime(),
    endMs: new Date(year + 1, 0, 1).getTime()
  }
}

/** What the picker calls a period. */
export function seasonLabel(year: number): string {
  return `Season ${year}`
}

/** A period as a RankRange, which is how it crosses the IPC boundary. */
export function seasonRange(year: number): RankRange {
  return `${SEASON_PREFIX}${year}`
}

/** The year a range names, or null when it is one of the relative ranges. */
export function parseSeasonRange(range: RankRange): number | null {
  const match = SEASON_RANGE.exec(range)
  return match ? Number(match[1]) : null
}

/**
 * A range as the time window it selects.
 *
 * The single place a RankRange becomes numbers, so the rank graph and the
 * champion table can never disagree about what a period covers.
 *
 * Both bounds are epoch milliseconds passed to SQL as bind parameters, never a
 * strftime expression: strftime('%Y', ..., 'unixepoch') is UTC while Date is
 * local, and for anyone off UTC the two would put a New Year's Eve game in
 * different years. The columns compared against — rank_snapshots.captured_at
 * and matches.game_creation — are already epoch ms for exactly this kind of
 * reason.
 */
export function rangeBounds(
  range: RankRange,
  now: number = Date.now()
): { sinceMs: number | null; untilMs: number | null } {
  if (range === 'all') return { sinceMs: null, untilMs: null }
  if (range === '7d') return { sinceMs: now - 7 * DAY_MS, untilMs: null }
  if (range === '30d') return { sinceMs: now - 30 * DAY_MS, untilMs: null }

  const year = parseSeasonRange(range)
  // An unparseable range is treated as all-time rather than as an error: it can
  // only come from a persisted or hand-edited value, and showing everything is
  // a better failure than showing nothing.
  if (year === null) return { sinceMs: null, untilMs: null }

  const { startMs, endMs } = seasonBounds(year)
  return { sinceMs: startMs, untilMs: endMs }
}

/**
 * Whether two moments sit in the same ranked year.
 *
 * The guard that keeps a January reset from being recorded as a real movement —
 * see attributeInterval and getRankMilestones.
 */
export function sameSeason(aMs: number, bMs: number): boolean {
  return seasonOf(aMs) === seasonOf(bMs)
}

/**
 * Every period covered by a span of data, newest first.
 *
 * Derived from the oldest and newest timestamps rather than from a DISTINCT
 * over rows, so a year the user did not play still appears between two they
 * did and the picker has no holes in it.
 */
export function seasonsBetween(oldestMs: number, newestMs: number): number[] {
  const first = seasonOf(oldestMs)
  const last = seasonOf(newestMs)
  const years: number[] = []
  for (let year = last; year >= first; year--) years.push(year)
  return years
}
