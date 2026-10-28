import { describe, expect, it } from 'vitest'
import type { LadderId } from '../games/ladders'
import type { MilestoneEntry, RankHistory, RankMilestone, RankSnapshot, Season } from '../types'
import { ladderPosition } from './ladder'
import { ladderMovementFor } from './ratedLadder'
import { milestoneTimeline } from './milestones'
import { resetsBetween } from './seasons'

const DAY = 86_400_000
const SOLO: LadderId = 'RANKED_SOLO_5x5'
const HYPER_ROLL: LadderId = 'RANKED_TFT_TURBO'

/** October 2026, the month of the screenshot that asked for this. */
const oct = (day: number, hour = 12, minute = 0): number => Date.UTC(2026, 9, day, hour, minute)

/** A reading in a division, written as `GOLD II` so the tests read like the page. */
function reading(division: string, capturedAt: number, ladder: LadderId = SOLO): RankSnapshot {
  const base = { queueType: ladder, wins: null, losses: null, seasonId: null, source: 'lcu' as const, capturedAt }
  if (ladder === HYPER_ROLL) {
    return { ...base, tier: null, rank: null, leaguePoints: null, ladderPosition: 0, ratedTier: division }
  }
  const [tier, rank] = division.split(' ')
  const leaguePoints = 50
  return { ...base, tier, rank, leaguePoints, ladderPosition: ladderPosition({ tier, rank, leaguePoints }) }
}

/** Readings as a history, with milestones read off them the way getRankMilestones does. */
function history(
  snapshots: RankSnapshot[],
  { before = null, peakBefore, seasons = [] }: { before?: RankSnapshot | null; peakBefore?: RankSnapshot | null; seasons?: Season[] } = {}
): RankHistory {
  const milestones: RankMilestone[] = []
  for (let i = 1; i < snapshots.length; i++) {
    if (resetsBetween(seasons, snapshots[i - 1].capturedAt, snapshots[i].capturedAt)) continue
    const movement = ladderMovementFor(snapshots[i].queueType, snapshots[i - 1], snapshots[i])
    if (movement === 'none') continue
    milestones.push({
      queueType: snapshots[i].queueType,
      movement,
      tier: snapshots[i].tier,
      rank: snapshots[i].rank,
      capturedAt: snapshots[i].capturedAt,
      ...(snapshots[i].ratedTier != null ? { ratedTier: snapshots[i].ratedTier } : {})
    })
  }
  return { snapshots, milestones: milestones.reverse(), before, ...(peakBefore !== undefined ? { peakBefore } : {}) }
}

const name = (m: RankMilestone): string => m.ratedTier ?? `${m.tier} ${m.rank}`

/** Each entry as one line: what the page would say, without the styling. */
function describeAll(entries: MilestoneEntry[]): string[] {
  return entries.map((e) => {
    if (e.kind === 'stretch') return `${e.milestones.length}× ${name(e.lower)} ⇄ ${name(e.upper)}`
    const note = e.note === null ? '' : e.note.kind === 'peak' ? ' (peak)' : ` (return${e.note.atLeast ? '+' : ''})`
    return `${e.milestone.movement === 'promotion' ? '↑' : '↓'} ${name(e.milestone)}${note}`
  })
}

const S2026: Season = { id: 1, label: 'Season 2026', startsAt: Date.UTC(2026, 0, 8), isPreseason: false, resetsRank: true }

describe('milestoneTimeline', () => {
  it('folds the screenshot that asked for it from 18 rows to 8, keeping every peak out of the fold', () => {
    const readings = [
      reading('GOLD IV', oct(1)),
      reading('GOLD III', oct(2, 17, 36)),
      reading('GOLD II', oct(3, 16, 10)),
      reading('GOLD I', oct(3, 20, 52)),
      reading('GOLD II', oct(4, 14, 59)),
      reading('GOLD I', oct(4, 15, 35)),
      reading('PLATINUM IV', oct(4, 20, 24)),
      reading('PLATINUM III', oct(10, 13, 33)),
      reading('PLATINUM IV', oct(10, 22, 39)),
      reading('PLATINUM III', oct(10, 23, 7)),
      reading('PLATINUM IV', oct(14, 19, 49)),
      reading('PLATINUM III', oct(14, 20, 30)),
      reading('PLATINUM IV', oct(17, 13, 54)),
      reading('PLATINUM III', oct(17, 17, 12)),
      reading('PLATINUM IV', oct(18, 13, 29)),
      reading('GOLD I', oct(23, 19, 15)),
      reading('PLATINUM IV', oct(24, 17, 3)),
      reading('GOLD I', oct(25, 20, 28)),
      reading('PLATINUM IV', oct(25, 22, 50))
    ]
    const h = history(readings, {
      before: reading('GOLD IV', Date.UTC(2026, 8, 28)),
      peakBefore: reading('GOLD IV', Date.UTC(2026, 8, 28))
    })
    expect(h.milestones).toHaveLength(18)

    const entries = milestoneTimeline(h, SOLO, [S2026])

    expect(describeAll(entries)).toEqual([
      '4× GOLD I ⇄ PLATINUM IV',
      '7× PLATINUM IV ⇄ PLATINUM III',
      '↑ PLATINUM III (peak)',
      '↑ PLATINUM IV (peak)',
      '2× GOLD II ⇄ GOLD I',
      '↑ GOLD I (peak)',
      '↑ GOLD II (peak)',
      '↑ GOLD III (peak)'
    ])

    // Newest first inside a fold too, so its first is where it ended.
    const top = entries[0]
    expect(top.kind === 'stretch' && top.milestones.map((m) => m.capturedAt)).toEqual([
      oct(25, 22, 50),
      oct(25, 20, 28),
      oct(24, 17, 3),
      oct(23, 19, 15)
    ])
  })

  it('shows a plain climb whole, every step a peak', () => {
    const h = history([reading('SILVER I', oct(1)), reading('GOLD IV', oct(2)), reading('GOLD III', oct(3))])
    expect(describeAll(milestoneTimeline(h, SOLO, []))).toEqual(['↑ GOLD III (peak)', '↑ GOLD IV (peak)'])
  })

  it('leaves a single slip and recovery as two rows', () => {
    const h = history([reading('GOLD II', oct(1)), reading('GOLD III', oct(2)), reading('GOLD II', oct(3))])
    expect(describeAll(milestoneTimeline(h, SOLO, []))).toEqual(['↑ GOLD II', '↓ GOLD III'])
  })

  it('folds three crossings of one line that nothing began', () => {
    const h = history([
      reading('GOLD II', oct(1)),
      reading('GOLD III', oct(2)),
      reading('GOLD II', oct(3)),
      reading('GOLD III', oct(4))
    ])
    expect(describeAll(milestoneTimeline(h, SOLO, []))).toEqual(['3× GOLD III ⇄ GOLD II'])
  })

  it('ends a run at two crossings the same way', () => {
    // Two demotions in a row: a slide, not a bounce, so neither half folds.
    const h = history([
      reading('GOLD I', oct(1)),
      reading('GOLD II', oct(2)),
      reading('GOLD I', oct(3)),
      reading('GOLD II', oct(4)),
      reading('GOLD III', oct(5)),
      reading('GOLD II', oct(6))
    ])
    expect(describeAll(milestoneTimeline(h, SOLO, []))).toEqual([
      '↑ GOLD II',
      '↓ GOLD III',
      '3× GOLD II ⇄ GOLD I'
    ])
  })

  it('measures a peak against the season before the range', () => {
    // Plat II earlier in the season: Plat III on this page is no first time.
    const h = history(
      [reading('PLATINUM IV', oct(20)), reading('PLATINUM III', oct(21)), reading('PLATINUM II', oct(22))],
      { peakBefore: reading('PLATINUM II', oct(1)) }
    )
    expect(describeAll(milestoneTimeline(h, SOLO, [S2026]))).toEqual(['↑ PLATINUM II', '↑ PLATINUM III'])
  })

  it('judges a peak from the range alone when a server sends no peakBefore', () => {
    const h = history([reading('PLATINUM IV', oct(20)), reading('PLATINUM III', oct(21))])
    expect(h.peakBefore).toBeUndefined()
    expect(describeAll(milestoneTimeline(h, SOLO, [S2026]))).toEqual(['↑ PLATINUM III (peak)'])
  })

  it('starts over after a reset: no run spans it, and the climb back is a peak again', () => {
    const SPLIT: Season = { id: 2, label: 'Split 2', startsAt: oct(10), isPreseason: false, resetsRank: true }
    const seasons = [S2026, SPLIT]
    const h = history(
      [
        reading('GOLD II', oct(1)),
        reading('GOLD I', oct(2)),
        reading('GOLD II', oct(3)),
        // Reset to Silver; the bounce before it and the climb after are separate.
        reading('SILVER I', oct(11)),
        reading('GOLD IV', oct(12))
      ],
      { peakBefore: reading('PLATINUM I', Date.UTC(2026, 4, 1)), seasons }
    )
    expect(describeAll(milestoneTimeline(h, SOLO, seasons))).toEqual(['↑ GOLD IV (peak)', '↓ GOLD II', '↑ GOLD I'])
  })

  it('keeps a return after a week out of the fold, and folds what follows it from two', () => {
    const h = history([
      reading('PLATINUM III', oct(1)),
      reading('PLATINUM IV', oct(2)),
      // Eight days at Plat IV, then back.
      reading('PLATINUM III', oct(10)),
      reading('PLATINUM IV', oct(10, 18)),
      reading('PLATINUM III', oct(10, 20))
    ])
    const entries = milestoneTimeline(h, SOLO, [])

    expect(describeAll(entries)).toEqual(['2× PLATINUM IV ⇄ PLATINUM III', '↑ PLATINUM III (return)', '↓ PLATINUM IV'])
    const back = entries[1]
    expect(back.kind === 'milestone' && back.note).toEqual({ kind: 'return', awayMs: 8 * DAY, atLeast: false })
  })

  it('folds a return of six days with the rest', () => {
    const h = history([
      reading('PLATINUM III', oct(1)),
      reading('PLATINUM IV', oct(2)),
      reading('PLATINUM III', oct(8)),
      reading('PLATINUM IV', oct(9))
    ])
    expect(describeAll(milestoneTimeline(h, SOLO, []))).toEqual(['3× PLATINUM IV ⇄ PLATINUM III'])
  })

  it('says a return is at least as long when the division was last held before the page begins', () => {
    // Plat III was the season's best, from before anything on the page.
    const h = history([reading('PLATINUM IV', oct(1)), reading('PLATINUM III', oct(9))], {
      peakBefore: reading('PLATINUM III', Date.UTC(2026, 8, 1))
    })
    const [entry] = milestoneTimeline(h, SOLO, [S2026])

    expect(entry.kind === 'milestone' && entry.note).toEqual({ kind: 'return', awayMs: 8 * DAY, atLeast: true })
  })

  it('counts the reading before the range as held, even from a server with no peakBefore', () => {
    // Plat IV going in, lost by the range's first reading, back eight days on.
    const h = history([reading('GOLD I', oct(3)), reading('PLATINUM IV', oct(11))], {
      before: reading('PLATINUM IV', oct(1))
    })
    const [entry] = milestoneTimeline(h, SOLO, [S2026])

    // Not a peak, and the time away is known rather than a lower bound.
    expect(entry.kind === 'milestone' && entry.note).toEqual({ kind: 'return', awayMs: 8 * DAY, atLeast: false })
  })

  it("folds Hyper Roll's colours the same way", () => {
    const h = history(
      [
        reading('GREEN', oct(1), HYPER_ROLL),
        reading('BLUE', oct(2), HYPER_ROLL),
        reading('GREEN', oct(3), HYPER_ROLL),
        reading('BLUE', oct(4), HYPER_ROLL),
        reading('GREEN', oct(5), HYPER_ROLL)
      ],
      { peakBefore: reading('GREEN', Date.UTC(2026, 8, 1), HYPER_ROLL) }
    )
    expect(describeAll(milestoneTimeline(h, HYPER_ROLL, [S2026]))).toEqual(['3× GREEN ⇄ BLUE', '↑ BLUE (peak)'])
  })

  it('has nothing to draw with nothing crossed', () => {
    expect(milestoneTimeline(history([]), SOLO, [])).toEqual([])
    expect(milestoneTimeline(history([reading('GOLD II', oct(1))]), SOLO, [])).toEqual([])
  })
})
