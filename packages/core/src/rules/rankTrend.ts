/**
 * The rank graphs: a queue's readings as closes rather than as every game.
 *
 * Every reading is around one a ranked game — hundreds a month, for somebody
 * who plays — and drawn as a line that is a sawtooth of wins and losses, not a
 * climb. So both graphs draw closes instead: the profile thirty days of them, a
 * close a day, and the Rank page its whole range, a close a day or, over a
 * week, one every six hours.
 *
 * Thinned, never smoothed. Each point is a reading somebody actually held,
 * repeated onto the moment it closed, so a tooltip can show "Gold II · 47 LP"
 * and be true. An average would draw a gentler line and put the player in a
 * division they never reached.
 *
 * Point k, for k = K down to 0, is drawn at `to − k·step` and repeats the last
 * reading taken before that moment. Everything else follows from that one rule:
 *
 * - The last reading of a day is its close.
 * - A day with no games repeats the day before, so a quiet week is flat.
 * - Point K is the reading from before the window, so the line starts at the
 *   left edge whenever there is history to start it from.
 * - Point 0 is the latest reading of all — including one stamped a moment after
 *   `now` by a clock running fast.
 * - Nothing is carried across a ladder reset. A day after one with no reading
 *   since has no point, and the line breaks there.
 *
 * Because the rule only ever looks backwards from each point, it gives the same
 * answer for any list that includes the carry-in and everything after it — the
 * servers read exactly that, the dev fixtures pass the whole series.
 *
 * The profile's thirty days are answered by whoever holds the readings: the
 * server runs the same rule, ported to Foxfire.Core as RankTrends, and
 * fixtures/rank-trend-corpus.json holds the two to the same answers. A change
 * here is a change there. The Rank page's closes are not ported: it reads every
 * reading anyway, for its milestones and its change over the period, and thins
 * them itself.
 */

import type {
  RankCloses,
  RankHistory,
  RankRange,
  RankTrend,
  RankTrendPoint,
  RankTrendReading,
  Season
} from '../types'
import { rangeBounds, resetsBetween, seasonAt } from './seasons'

export const RANK_TREND_DAYS = 30

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * How far apart the Rank page draws its closes over a range.
 *
 * A week of daily closes is eight points, which hides what a busy evening did;
 * every six hours is twenty-nine. Anything longer is a close a day, which makes
 * thirty days the profile's graph exactly.
 */
export function rankCloseStep(range: RankRange): number {
  return range === '7d' ? 6 * HOUR_MS : DAY_MS
}

/** Where the window opens: the moment point 30 is drawn at. */
export function rankTrendSince(now: number): number {
  return now - RANK_TREND_DAYS * DAY_MS
}

/** Where somebody stood, as the net-change rule reads it. */
export interface LadderMark {
  ladderPosition: number | null
  seasonId: number | null
}

/**
 * The ladder change over a window, or null where it would not mean anything.
 *
 * Counted from `before` — the last reading ahead of the window — so a month's
 * change includes the month's first game. Without it, somebody who played once
 * after a quiet month would have gained nothing.
 *
 * Only inside one season. A reading from before a reset is not a place anyone
 * lost LP from, so the count falls back to the first reading inside the window,
 * and a window a reset runs through has no change to report at all — the gap
 * between its two ends is the reset itself.
 *
 * `window` is the readings inside it, oldest first. With none, the change is
 * zero from `before`: a month without a ranked game moved nobody.
 */
export function rankNetChange(
  before: LadderMark | null | undefined,
  window: readonly LadderMark[]
): number | null {
  const last = window.length > 0 ? window[window.length - 1] : before
  if (!last) return null

  const first = before && before.seasonId === last.seasonId ? before : window[0]
  if (!first) return null

  if (first.seasonId !== last.seasonId) return null
  if (first.ladderPosition === null || last.ladderPosition === null) return null

  return last.ladderPosition - first.ladderPosition
}

/**
 * The closes of one queue's readings over [from, to], `step` apart and ending
 * at `to`, by the rule at the top of this file.
 *
 * The readings must be oldest first and ordered as stored — by capturedAt,
 * then by id — so two readings in the same millisecond keep their order. Never
 * re-sorted here: the server's sort is not stable.
 */
export function rankCloses(
  readings: readonly RankTrendReading[],
  seasons: Season[],
  from: number,
  to: number,
  step: number = DAY_MS
): RankTrendPoint[] {
  const points: RankTrendPoint[] = []
  let cursor = 0
  let held: RankTrendReading | null = null

  // At least the last point, even for a window a fast clock has turned inside
  // out — a lone reading stamped after now still has somewhere to be drawn.
  for (let k = Math.max(0, Math.floor((to - from) / step)); k >= 0; k--) {
    const at = to - k * step

    // The last point is the latest reading of all; every earlier one is the
    // last reading taken strictly before its moment.
    while (cursor < readings.length && (k === 0 || readings[cursor].capturedAt < at)) {
      held = readings[cursor]
      cursor++
    }

    if (held === null || resetsBetween(seasons, held.capturedAt, at)) continue

    points.push({
      at,
      tier: held.tier,
      rank: held.rank,
      leaguePoints: held.leaguePoints,
      ladderPosition: held.ladderPosition,
      seasonId: seasonAt(seasons, held.capturedAt)?.id ?? null,
      capturedAt: held.capturedAt
    })
  }

  return points
}

/**
 * The Rank page's graph, from the history it already holds.
 *
 * The window is the range's, from rangeBounds — the same numbers the history
 * was read with. A range with no start (All, or the oldest season) starts at
 * the first reading. A past season ends a millisecond before the next one
 * starts, so its last close is where the player finished rather than a point
 * the next season's reset has already taken away.
 *
 * `seasons` must be the whole table, not the account's periods: those stop at
 * its newest reading, and a reset after somebody's last game would go unseen,
 * carrying their old rank flat to today.
 */
export function rankRangeCloses(
  history: RankHistory,
  range: RankRange,
  seasons: Season[],
  now: number
): RankCloses {
  const readings = history.before ? [history.before, ...history.snapshots] : history.snapshots
  const { sinceMs, untilMs } = rangeBounds(range, seasons, now)
  const to = untilMs === null ? now : untilMs - 1
  const from = sinceMs ?? readings[0]?.capturedAt ?? to
  const step = rankCloseStep(range)

  return { from, to, step, points: rankCloses(readings, seasons, from, to, step) }
}

/**
 * The profile's thirty days: `rankCloses` a day apart, ending now, with the
 * change over the window. The readings are ordered as `rankCloses` needs them.
 */
export function rankTrend(
  readings: readonly RankTrendReading[],
  seasons: Season[],
  now: number
): RankTrend {
  const since = rankTrendSince(now)
  const seasonOf = (reading: RankTrendReading): number | null =>
    seasonAt(seasons, reading.capturedAt)?.id ?? null

  const points = rankCloses(readings, seasons, since, now)

  // The change comes from the readings, not from the closes: two games on the
  // window's first day both count, where the closes would only see the second.
  let before: RankTrendReading | null = null
  const window: RankTrendReading[] = []
  for (const reading of readings) {
    if (reading.capturedAt < since) before = reading
    else window.push(reading)
  }

  const stamp = (r: RankTrendReading): LadderMark => ({
    ladderPosition: r.ladderPosition,
    seasonId: seasonOf(r)
  })

  return {
    from: since,
    to: now,
    points,
    netLp: rankNetChange(before && stamp(before), window.map(stamp))
  }
}
