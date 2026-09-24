import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rankTrend } from './rankTrend'
import type { RankTrend, RankTrendReading, Season } from '../types'

/**
 * The TypeScript half of the corpus that pins the profile's rank graph to the
 * server's — the half the desktop runs over its own database.
 *
 * rankTrend.test.ts says what the rule should do. This says it has not moved:
 * fixtures/rank-trend-corpus.json holds the answers this code gave, and the
 * server's RankTrendCorpusTests asserts its port gives them too. A graph that
 * drew differently on a server than on somebody's own machine would read as
 * lost history.
 *
 * Regenerate deliberately, with `npm run generate-trend-corpus`, and never to
 * make a failure go away — a diff in the file is a change to every server.
 */

/** Walks up to the repo root rather than counting directories; see ladder.corpus.test.ts. */
function findCorpus(): string {
  let dir = dirname(fileURLToPath(import.meta.url))

  for (;;) {
    const candidate = join(dir, 'fixtures', 'rank-trend-corpus.json')
    if (existsSync(candidate)) return candidate

    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        'fixtures/rank-trend-corpus.json was not found. Generate it with `npm run generate-trend-corpus`.'
      )
    }
    dir = parent
  }
}

interface Corpus {
  seasons: Season[]
  cases: Array<{ name: string; now: number; readings: RankTrendReading[]; trend: RankTrend }>
}

const corpus: Corpus = JSON.parse(readFileSync(findCorpus(), 'utf8'))

describe('the rank trend corpus', () => {
  it('is big enough to mean something', () => {
    expect(corpus.cases.length).toBeGreaterThan(50)
    expect(corpus.cases.reduce((n, c) => n + c.trend.points.length, 0)).toBeGreaterThan(1_000)
    // The reset cases are the point of it; a corpus without them would pass
    // everything the unit tests already do.
    expect(corpus.cases.some((c) => c.trend.netLp === null && c.trend.points.length > 0)).toBe(true)
  })

  it('still produces the recorded trends', () => {
    const drifted = corpus.cases.filter(
      (c) => JSON.stringify(rankTrend(c.readings, corpus.seasons, c.now)) !== JSON.stringify(c.trend)
    )

    expect(drifted.map((c) => c.name)).toEqual([])
  })
})
