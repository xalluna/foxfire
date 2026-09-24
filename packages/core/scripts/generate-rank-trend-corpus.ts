/**
 * Writes the golden corpus that pins the profile's rank graph — rules/rankTrend.ts,
 * which the desktop runs over its own database — to the server's port of it.
 *
 * Run with: npm run generate-trend-corpus   (from packages/core)
 *
 * The same reasoning as generate-ladder-corpus.ts, and a separate file for two
 * reasons: that corpus is large enough that regenerating it for an unrelated
 * rule would be a diff nobody could review, and its seasons are local dates, so
 * it only regenerates identically in the timezone it was written in. Everything
 * here is UTC and enumerated, so the file is the same on any machine.
 *
 * The cases are chosen for where the rule can be off by one: readings on, and a
 * millisecond either side of, each day's boundary; windows opening, closing and
 * sitting astride a reset; a preseason that carries rank; readings stamped
 * after now; and two long walks for everything the edges do not reach.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rankAtPosition } from '../src/rules/ladder'
import { rankTrend } from '../src/rules/rankTrend'
import type { RankTrendReading, Season } from '../src/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', '..', 'fixtures', 'rank-trend-corpus.json')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const SEASONS: Season[] = [
  { id: 1, label: 'Season 2026', startsAt: Date.UTC(2026, 0, 8), isPreseason: false, resetsRank: true },
  { id: 2, label: 'Preseason 2027', startsAt: Date.UTC(2026, 11, 22), isPreseason: true, resetsRank: false },
  { id: 3, label: 'Season 2027', startsAt: Date.UTC(2027, 0, 8), isPreseason: false, resetsRank: true }
]

const RESET_2027 = SEASONS[2].startsAt
const RESET_2026 = SEASONS[0].startsAt

/** The moments the window is measured back from. */
const NOWS: Array<[string, number]> = [
  ['mid-season', Date.UTC(2026, 5, 15, 12)],
  ['preseason inside the window', Date.UTC(2027, 0, 2, 9, 30)],
  ['reset inside the window', Date.UTC(2027, 0, 20, 18)],
  ['now exactly on a reset', RESET_2027],
  ['window opening exactly on a reset', RESET_2026 + 30 * DAY],
  ['reset a millisecond before the window', RESET_2026 + 30 * DAY + 1]
]

function reading(position: number | null, capturedAt: number): RankTrendReading {
  if (position === null) {
    return { tier: null, rank: null, leaguePoints: null, ladderPosition: null, capturedAt }
  }
  return { ...rankAtPosition(position), ladderPosition: position, capturedAt }
}

/** Ordered as stored: by time, and by insertion within a millisecond. */
function stored(readings: RankTrendReading[]): RankTrendReading[] {
  return readings
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.capturedAt - b.r.capturedAt || a.i - b.i)
    .map(({ r }) => r)
}

/** A deterministic walk: the same numbers every run, on every machine. */
function walk(start: number, steps: number, seed: number): number[] {
  let state = seed
  let position = start
  const out: number[] = []
  for (let i = 0; i < steps; i++) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    // Wins and losses of roughly a game's worth, with the odd promotion-sized jump.
    const step = (state % 61) - 29
    position = Math.max(0, position + step)
    out.push(position)
  }
  return out
}

function scenarios(now: number): Array<[string, RankTrendReading[]]> {
  const dayAt = (k: number): number => now - k * DAY

  const edges: RankTrendReading[] = []
  let position = 1000
  for (const k of [30, 29, 15, 1]) {
    for (const offset of [-1, 0, 1]) {
      edges.push(reading(position, dayAt(k) + offset))
      position += 7
    }
  }

  const cluster = [
    reading(1500, dayAt(7) - 20 * HOUR),
    reading(1520, dayAt(7) - 9 * HOUR),
    reading(1498, dayAt(7) - 2 * HOUR),
    reading(1510, dayAt(7) - MINUTE),
    reading(1490, dayAt(7) - MINUTE)
  ]

  const dense = walk(1400, Math.floor((60 * DAY) / (7 * HOUR + 13 * MINUTE)), now % 997).map((p, i) =>
    reading(p, now - 60 * DAY + i * (7 * HOUR + 13 * MINUTE))
  )

  const sparse = walk(900, 23, (now % 991) + 3).map((p, i) => reading(p, now - 90 * DAY + i * 4 * DAY))

  const straddle = SEASONS.flatMap((s, i) => [
    reading(1200 + i * 40, s.startsAt - 1),
    reading(1300 + i * 40, s.startsAt),
    reading(1400 + i * 40, s.startsAt + 1)
  ])

  return [
    ['empty', []],
    ['carry-in only', [reading(1234, now - 40 * DAY)]],
    ['one reading two hours ago', [reading(1234, now - 2 * HOUR)]],
    ['readings on and either side of day boundaries', edges],
    ['several readings in one day, two in one millisecond', cluster],
    ['a reading stamped after now', [reading(1100, dayAt(3)), reading(1130, now + 90_000)]],
    ['unranked carry-in', [reading(null, now - 35 * DAY), reading(1000, dayAt(20)), reading(1060, dayAt(4))]],
    ['unranked latest', [reading(1000, now - 35 * DAY), reading(1060, dayAt(20)), reading(null, dayAt(2))]],
    ['dense walk', dense],
    ['sparse walk', sparse],
    ['readings straddling each season boundary', straddle]
  ]
}

const cases = NOWS.flatMap(([when, now]) =>
  scenarios(now).map(([what, readings]) => {
    const ordered = stored(readings)
    return { name: `${when}: ${what}`, now, readings: ordered, trend: rankTrend(ordered, SEASONS, now) }
  })
)

const corpus = {
  note:
    'Generated by packages/core/scripts/generate-rank-trend-corpus.ts. Pins the desktop and the ' +
    'server to the same thirty-day rank trend. Regenerate deliberately, never to make a test pass.',
  seasons: SEASONS,
  cases
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(corpus)}\n`)

console.log(`Wrote ${OUT}`)
console.log(`cases: ${cases.length}, points: ${cases.reduce((n, c) => n + c.trend.points.length, 0)}`)
