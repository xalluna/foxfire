import { describe, expect, it } from 'vitest'
import type { InsightsFrame } from '../types'
import {
  DEFAULT_INSIGHTS_WINDOW,
  INSIGHTS_WINDOWS,
  formatInsightTime,
  insightPoints,
  insightSeries,
  insightsPollMs,
  isInsightsWindow
} from './insights'

describe('the insights windows', () => {
  it('offers the seven the server knows, shortest first', () => {
    expect(INSIGHTS_WINDOWS.map((w) => w.key)).toEqual(['15m', '1h', '6h', '24h', '48h', '7d', '30d'])
    expect(isInsightsWindow(DEFAULT_INSIGHTS_WINDOW)).toBe(true)
    expect(isInsightsWindow('3y')).toBe(false)
  })

  it('asks again as often as the newest point can change', () => {
    expect(insightsPollMs('15m')).toBe(5_000)
    expect(insightsPollMs('1h')).toBe(30_000)
    expect(insightsPollMs('6h')).toBe(30_000)
    expect(insightsPollMs('24h')).toBe(60_000)
    expect(insightsPollMs('30d')).toBe(60_000)
  })

  it('never asks more often for a longer window', () => {
    const polls = INSIGHTS_WINDOWS.map((w) => insightsPollMs(w.key))
    expect([...polls].sort((a, b) => a - b)).toEqual(polls)
  })
})

describe('formatInsightTime', () => {
  // Local time, so the expectations hold in any time zone.
  const at = new Date(2026, 8, 26, 14, 5, 9).getTime()

  it('is only as precise as the window’s points', () => {
    expect(formatInsightTime(at, '15m')).toBe('14:05:09')
    expect(formatInsightTime(at, '1h')).toBe('14:05')
    expect(formatInsightTime(at, '6h')).toBe('14:05')
  })

  it('names the day once the window is a day or more, whose two ends share a clock time', () => {
    expect(formatInsightTime(at, '24h')).toBe('Sat 14:05')
    expect(formatInsightTime(at, '48h')).toBe('Sat 14:05')
    expect(formatInsightTime(at, '7d')).toBe('Sat 14:05')
    expect(formatInsightTime(at, '30d')).toBe('26 Sep 14:05')
  })
})

describe('insightPoints', () => {
  const frame: InsightsFrame = {
    window: '15m',
    from: 1_000_000,
    stepMs: 10_000,
    points: 3,
    now: 1_025_000,
    historyFrom: null,
    startedAt: 900_000,
    up: [true, true, true]
  }

  it('puts each value at the start of its step', () => {
    expect(insightPoints(frame, { key: 'requests', values: [1, null, 4] })).toEqual([
      { at: 1_000_000, value: 1 },
      { at: 1_010_000, value: null },
      { at: 1_020_000, value: 4 }
    ])
  })

  it('draws nothing for a series the server did not send', () => {
    expect(insightPoints(frame, insightSeries([], 'p95'))).toEqual([])
  })
})
