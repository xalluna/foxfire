/**
 * The profile's rank graph: thirty days of one queue, a close a day.
 *
 * The Rank page draws every reading, which over a month is around one a ranked
 * game — hundreds, for somebody who plays. Drawn 300px wide that is noise, and
 * sent to every profile view it is most of the response. So the profile asks
 * for this instead: 31 points, one for each day's close, whatever the history
 * holds.
 *
 * Thinned, never smoothed. Each point is a reading somebody actually held,
 * repeated onto the day it closed, so a tooltip can show "Gold II · 47 LP" and
 * be true. An average would draw a gentler line and put the player in a
 * division they never reached.
 *
 * Point k, for k = 30 down to 0, is drawn at `now − k·24h` and repeats the last
 * reading taken before that moment. Everything else follows from that one rule:
 *
 * - The last reading of a day is its close.
 * - A day with no games repeats the day before, so a quiet week is flat.
 * - Point 30 is the reading from before the window, so the line starts at the
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
 * The server runs the same rule, ported to Foxfire.Core as RankTrends, and
 * fixtures/rank-trend-corpus.json holds the two to the same answers. A change
 * here is a change there.
 */

import type { RankTrend, RankTrendPoint, RankTrendReading, Season } from '../types'
import { resetsBetween, seasonAt } from './seasons'

export const RANK_TREND_DAYS = 30

const DAY_MS = 86_400_000

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
 * The trend of one queue's readings, which must be oldest first and ordered as
 * stored — by capturedAt, then by id — so two readings in the same millisecond
 * keep their order. Never re-sorted here: the server's sort is not stable.
 */
export function rankTrend(
  readings: readonly RankTrendReading[],
  seasons: Season[],
  now: number
): RankTrend {
  const since = rankTrendSince(now)
  const seasonOf = (reading: RankTrendReading): number | null =>
    seasonAt(seasons, reading.capturedAt)?.id ?? null

  const points: RankTrendPoint[] = []
  let cursor = 0
  let held: RankTrendReading | null = null

  for (let k = RANK_TREND_DAYS; k >= 0; k--) {
    const at = now - k * DAY_MS

    // Today's point is the latest reading of all; every earlier one is the
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
      seasonId: seasonOf(held),
      capturedAt: held.capturedAt
    })
  }

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
