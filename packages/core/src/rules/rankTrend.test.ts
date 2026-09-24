import { describe, expect, it } from 'vitest'
import type { RankTrendReading, Season } from '../types'
import { rankAtPosition } from './ladder'
import { RANK_TREND_DAYS, rankNetChange, rankTrend, rankTrendSince } from './rankTrend'

const DAY = 86_400_000
const HOUR = 3_600_000

const NOW = Date.UTC(2026, 5, 15, 12)
const SINCE = rankTrendSince(NOW)

/** Where point k is drawn: k days before now. */
const dayAt = (k: number): number => NOW - k * DAY

/** A reading at a ladder position, so the tests talk in LP rather than in tiers. */
function reading(position: number | null, capturedAt: number): RankTrendReading {
  if (position === null) {
    return { tier: null, rank: null, leaguePoints: null, ladderPosition: null, capturedAt }
  }
  const rank = rankAtPosition(position)
  return { ...rank, ladderPosition: position, capturedAt }
}

const S2026: Season = {
  id: 1,
  label: 'Season 2026',
  startsAt: Date.UTC(2026, 0, 8),
  isPreseason: false,
  resetsRank: true
}
const SEASONS = [S2026]

/** A reset opening a new season `k` days before now. */
function resetAt(ms: number): Season[] {
  return [S2026, { id: 2, label: 'Split 2', startsAt: ms, isPreseason: false, resetsRank: true }]
}

describe('rankTrend', () => {
  it('draws 31 points a day apart, ending now', () => {
    const trend = rankTrend([reading(1200, SINCE - DAY)], SEASONS, NOW)

    expect(trend.from).toBe(SINCE)
    expect(trend.to).toBe(NOW)
    expect(trend.points).toHaveLength(RANK_TREND_DAYS + 1)
    expect(trend.points.map((p) => p.at)).toEqual(
      Array.from({ length: RANK_TREND_DAYS + 1 }, (_, i) => dayAt(RANK_TREND_DAYS - i))
    )
  })

  it("takes a day's last reading as its close", () => {
    const trend = rankTrend(
      [
        reading(1200, dayAt(5) - 20 * HOUR),
        reading(1220, dayAt(5) - 10 * HOUR),
        reading(1240, dayAt(5) - HOUR)
      ],
      SEASONS,
      NOW
    )

    const close = trend.points.find((p) => p.at === dayAt(5))
    expect(close?.ladderPosition).toBe(1240)
  })

  it('keeps stored order for two readings in the same millisecond', () => {
    const trend = rankTrend(
      [reading(1200, dayAt(3) - HOUR), reading(1180, dayAt(3) - HOUR)],
      SEASONS,
      NOW
    )

    expect(trend.points.at(-1)?.ladderPosition).toBe(1180)
  })

  it('repeats the previous close on a day without a game', () => {
    const played = dayAt(10) - HOUR
    const trend = rankTrend([reading(1200, played)], SEASONS, NOW)

    const quiet = trend.points.filter((p) => p.at >= dayAt(10))
    expect(quiet).toHaveLength(11)
    for (const p of quiet) {
      expect(p.ladderPosition).toBe(1200)
      expect(p.capturedAt).toBe(played)
    }
  })

  it('starts from the reading before the window', () => {
    const trend = rankTrend(
      [reading(900, SINCE - 45 * DAY), reading(1000, SINCE - 3 * DAY), reading(1100, dayAt(4))],
      SEASONS,
      NOW
    )

    expect(trend.points[0]).toMatchObject({ at: SINCE, ladderPosition: 1000 })
  })

  it('starts partway across when tracking began inside the window', () => {
    const trend = rankTrend([reading(1000, dayAt(8) - HOUR)], SEASONS, NOW)

    expect(trend.points[0].at).toBe(dayAt(8))
    expect(trend.points).toHaveLength(9)
  })

  it('counts a reading exactly on a boundary into the day after it', () => {
    const trend = rankTrend([reading(1000, SINCE)], SEASONS, NOW)

    // At `since` exactly, it is inside the window: point 30 is "before since".
    expect(trend.points[0].at).toBe(dayAt(29))
  })

  it("makes a reading stamped after now today's point", () => {
    const trend = rankTrend(
      [reading(1000, dayAt(2)), reading(1050, NOW + 5_000)],
      SEASONS,
      NOW
    )

    expect(trend.points.at(-1)).toMatchObject({ at: NOW, ladderPosition: 1050 })
    expect(trend.points.at(-2)?.ladderPosition).toBe(1000)
  })

  it('carries nothing across a reset', () => {
    const reset = dayAt(12) - 6 * HOUR
    const trend = rankTrend(
      [reading(1500, dayAt(20)), reading(400, dayAt(5) - HOUR)],
      resetAt(reset),
      NOW
    )

    const ats = trend.points.map((p) => p.at)
    // The old season runs up to the last point before the reset...
    expect(ats).toContain(dayAt(13))
    // ...there is nothing between it and the first new-season game...
    for (let k = 12; k > 5; k--) expect(ats).not.toContain(dayAt(k))
    // ...and the new season resumes on its own reading.
    expect(trend.points.find((p) => p.at === dayAt(5))).toMatchObject({
      ladderPosition: 400,
      seasonId: 2
    })
  })

  it('drops a carry-in the window opened after a reset from', () => {
    const trend = rankTrend(
      [reading(1500, SINCE - DAY), reading(300, dayAt(20))],
      resetAt(SINCE - 6 * HOUR),
      NOW
    )

    expect(trend.points[0]).toMatchObject({ at: dayAt(19), ladderPosition: 300 })
  })

  it("leaves today empty after a reset nobody has played since", () => {
    const trend = rankTrend([reading(1500, dayAt(9))], resetAt(dayAt(3)), NOW)

    expect(trend.points.at(-1)?.at).toBe(dayAt(4))
  })

  it('carries rank into a season that does not reset, and breaks the line there', () => {
    const preseason: Season = {
      id: 2,
      label: 'Preseason',
      startsAt: dayAt(10),
      isPreseason: true,
      resetsRank: false
    }
    const trend = rankTrend([reading(1500, dayAt(15))], [S2026, preseason], NOW)

    // Carried: the reading still stands after the boundary, still in its season.
    expect(trend.points.at(-1)).toMatchObject({ ladderPosition: 1500, seasonId: 1 })
  })

  it('stamps each point with the season of its reading', () => {
    const trend = rankTrend([reading(1000, dayAt(2))], SEASONS, NOW)

    expect(trend.points.every((p) => p.seasonId === S2026.id)).toBe(true)
  })

  it('has no points and no change for an account with no readings', () => {
    expect(rankTrend([], SEASONS, NOW)).toEqual({ from: SINCE, to: NOW, points: [], netLp: null })
  })

  describe('netLp', () => {
    it('counts from the reading before the window', () => {
      const trend = rankTrend(
        [reading(1000, SINCE - DAY), reading(1040, dayAt(20)), reading(1100, dayAt(1))],
        SEASONS,
        NOW
      )
      expect(trend.netLp).toBe(100)
    })

    it('counts every game, not only the closes', () => {
      // Three games on one day: the closes only see the last, the change sees
      // all three from where the window started.
      const trend = rankTrend(
        [
          reading(1000, dayAt(10) - 20 * HOUR),
          reading(1020, dayAt(10) - 10 * HOUR),
          reading(990, dayAt(10) - HOUR)
        ],
        SEASONS,
        NOW
      )
      expect(trend.netLp).toBe(-10)
    })

    it('is nothing for a month without a game', () => {
      expect(rankTrend([reading(1000, SINCE - DAY)], SEASONS, NOW).netLp).toBe(0)
    })

    it('counts from the first reading after a reset the window opened across', () => {
      const trend = rankTrend(
        [reading(1500, SINCE - DAY), reading(300, dayAt(20)), reading(420, dayAt(2))],
        resetAt(SINCE - 6 * HOUR),
        NOW
      )
      expect(trend.netLp).toBe(120)
    })

    it('has no answer for a window a reset runs through', () => {
      const trend = rankTrend(
        [reading(1500, dayAt(20)), reading(400, dayAt(5))],
        resetAt(dayAt(12)),
        NOW
      )
      expect(trend.netLp).toBeNull()
    })

    it('has no answer from or to an unranked reading', () => {
      expect(rankTrend([reading(null, dayAt(20)), reading(400, dayAt(5))], SEASONS, NOW).netLp).toBeNull()
      expect(rankTrend([reading(400, dayAt(20)), reading(null, dayAt(5))], SEASONS, NOW).netLp).toBeNull()
    })
  })
})

describe('rankNetChange', () => {
  const at = (ladderPosition: number | null, seasonId: number | null = 1) => ({ ladderPosition, seasonId })

  it('counts from before when it is in the same season', () => {
    expect(rankNetChange(at(1000), [at(1040), at(1100)])).toBe(100)
  })

  it('counts from the first reading when there is nothing before', () => {
    expect(rankNetChange(null, [at(1040), at(1100)])).toBe(60)
    expect(rankNetChange(undefined, [at(1040), at(1100)])).toBe(60)
  })

  it('falls back to the first reading when before is from another season', () => {
    expect(rankNetChange(at(1900, 1), [at(300, 2), at(380, 2)])).toBe(80)
  })

  it('has no answer across seasons inside the window', () => {
    expect(rankNetChange(null, [at(1500, 1), at(300, 2)])).toBeNull()
  })

  it('has no answer with nothing to count', () => {
    expect(rankNetChange(null, [])).toBeNull()
  })
})
