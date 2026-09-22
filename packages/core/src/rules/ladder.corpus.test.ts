import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ladderPosition, rankFromLeaguePoints, rankMovement, tierAtPosition } from './ladder'
import { resetsBetween } from './seasons'
import type { Season } from '../types'

/**
 * The TypeScript half of the golden corpus that pins it to the server — the
 * half both the desktop and the web client run.
 *
 * Foxfire computes LP twice now, in two languages, and shows both answers to the
 * same person — a disagreement between them would read as lost history rather
 * than as a bug. fixtures/ladder-corpus.json holds a set of inputs and the
 * answers this code gave for them; the server's suite asserts it produces the
 * same file, and this asserts the desktop still does.
 *
 * So this is not testing that the maths is right — ladder.test.ts and
 * seasons.test.ts do that. It is testing that the maths has not *moved*, which
 * is a different and more slippery thing: a change here that looks harmless can
 * silently put the two implementations out of step, and nothing else would
 * catch it until somebody noticed their LP was different on a server than on
 * their own machine.
 *
 * Regenerate deliberately, with `npm run generate-corpus`, and never to make a
 * failure go away — a diff in this file is a claim that every Foxfire Server in
 * existence now needs updating too.
 */

/**
 * Found by walking up rather than by counting directories.
 *
 * The corpus sits at the repo root because it belongs to neither app — and a
 * hardcoded depth is a thing that breaks the next time a file moves, silently,
 * by pointing somewhere that does not exist. The server locates it the same way.
 */
function findCorpus(): string {
  let dir = dirname(fileURLToPath(import.meta.url))

  for (;;) {
    const candidate = join(dir, 'fixtures', 'ladder-corpus.json')
    if (existsSync(candidate)) return candidate

    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        'fixtures/ladder-corpus.json was not found. Generate it with `npm run generate-corpus`.'
      )
    }
    dir = parent
  }
}

const CORPUS = findCorpus()

interface RankCase {
  tier: string | null
  rank: string | null
  leaguePoints: number | null
}

interface Corpus {
  ladderPosition: Array<{ rank: RankCase; position: number | null }>
  tierAtPosition: Array<{ position: number; tier: string }>
  rankMovement: Array<{ before: RankCase; after: RankCase; movement: string }>
  rankFromLeaguePoints: Array<{
    before: RankCase
    leaguePoints: number
    result: { tier: string; rank: string | null; leaguePoints: number } | null
  }>
  seasons: Season[]
  resetsBetween: Array<{ afterMs: number; untilMs: number; resets: boolean }>
}

const corpus: Corpus = JSON.parse(readFileSync(CORPUS, 'utf8'))

/**
 * Reports the first few disagreements rather than only the first.
 *
 * Maths that has moved is usually wrong about a whole class of inputs, and five
 * of them together say which class. One says almost nothing.
 */
function expectNoDrift(drifted: string[], total: number): void {
  if (drifted.length === 0) return

  const shown = drifted.slice(0, 5).join('\n  ')
  const more = drifted.length > 5 ? `\n  … and ${drifted.length - 5} more` : ''
  throw new Error(`${drifted.length} of ${total} cases no longer match the corpus.\n  ${shown}${more}`)
}

function show(rank: RankCase | { tier: string; rank: string | null; leaguePoints: number } | null): string {
  return rank === null ? 'null' : `${rank.tier} ${rank.rank} ${rank.leaguePoints}`
}

describe('the ladder corpus', () => {
  it('is big enough to mean something', () => {
    // Guards against the corpus being regenerated to nothing and everything
    // below passing vacuously.
    expect(corpus.ladderPosition.length).toBeGreaterThan(500)
    expect(corpus.rankMovement.length).toBeGreaterThan(5_000)
    expect(corpus.rankFromLeaguePoints.length).toBeGreaterThan(1_000)
  })

  it('still produces the recorded ladder positions', () => {
    const drifted: string[] = []
    for (const c of corpus.ladderPosition) {
      const now = ladderPosition(c.rank)
      if (now !== c.position) drifted.push(`${show(c.rank)}: corpus ${c.position}, now ${now}`)
    }
    expectNoDrift(drifted, corpus.ladderPosition.length)
  })

  it('still produces the recorded tiers', () => {
    const drifted: string[] = []
    for (const c of corpus.tierAtPosition) {
      const now = tierAtPosition(c.position)
      if (now !== c.tier) drifted.push(`${c.position}: corpus ${c.tier}, now ${now}`)
    }
    expectNoDrift(drifted, corpus.tierAtPosition.length)
  })

  it('still produces the recorded movements', () => {
    const drifted: string[] = []
    for (const c of corpus.rankMovement) {
      const now = rankMovement(c.before, c.after)
      if (now !== c.movement) {
        drifted.push(`${show(c.before)} -> ${show(c.after)}: corpus ${c.movement}, now ${now}`)
      }
    }
    expectNoDrift(drifted, corpus.rankMovement.length)
  })

  it('still produces the recorded ranks from bare LP', () => {
    const drifted: string[] = []
    for (const c of corpus.rankFromLeaguePoints) {
      const now = rankFromLeaguePoints(c.before, c.leaguePoints)
      const same =
        now === null || c.result === null
          ? now === c.result
          : now.tier === c.result.tier &&
            now.rank === c.result.rank &&
            now.leaguePoints === c.result.leaguePoints

      if (!same) {
        drifted.push(
          `${show(c.before)} + ${c.leaguePoints} LP: corpus ${show(c.result)}, now ${show(now)}`
        )
      }
    }
    expectNoDrift(drifted, corpus.rankFromLeaguePoints.length)
  })

  it('still agrees about which intervals contain a reset', () => {
    const drifted: string[] = []
    for (const c of corpus.resetsBetween) {
      const now = resetsBetween(corpus.seasons, c.afterMs, c.untilMs)
      if (now !== c.resets) {
        drifted.push(`(${c.afterMs}, ${c.untilMs}]: corpus ${c.resets}, now ${now}`)
      }
    }
    expectNoDrift(drifted, corpus.resetsBetween.length)
  })
})
