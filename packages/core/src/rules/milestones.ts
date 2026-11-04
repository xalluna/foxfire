/**
 * The Rank page's milestones as a timeline: the crossings worth reading, with
 * the back-and-forth folded away.
 *
 * Somebody who sits on a line crosses it over and over — Plat III, Plat IV,
 * Plat III, Plat IV — and a list of every crossing is a wall of rows that adds
 * up to nothing. So a run of crossings back and forth over one line is folded
 * into a single row, which the page can open. What a run is:
 *
 * - Each crossing goes the opposite way to the one before it, into the division
 *   the one two back went into. Two the same way, a third division, or a ladder
 *   reset between two ends the run.
 * - Three crossings or more fold. Two are a peak and its loss, or a slip and its
 *   recovery, and stay as they are.
 *
 * Some crossings are worth more than the noise around them, and are never
 * folded:
 *
 * - A **peak** — a promotion into a division above anything held since the
 *   ladder last reset. History's `peakBefore` says what the season reached
 *   before the range, so a thirty-day view knows the difference between a first
 *   time and a return.
 * - A **return** — a promotion into a division not held for a week or more.
 *
 * Either one ends the run it is in and stands on its own; the crossings after
 * it on the same line fold from two, since the row above them already says how
 * the run began.
 *
 * Only clients draw it, so unlike the rank trend there is no copy of this on
 * the server.
 */

import type { LadderId } from '../games/ladders'
import type {
  MilestoneEntry,
  MilestoneNote,
  RankHistory,
  RankMilestone,
  RankSnapshot,
  Season
} from '../types'
import { ALL_TIERS, DIVISIONED_TIERS, DIVISIONS } from './ladder'
import { RATED_TIERS, ladderMovementFor, ladderScale, type LadderReading } from './ratedLadder'
import { resetsBetween } from './seasons'

const DAY_MS = 86_400_000

/** How long away from a division makes getting back to it worth saying. */
export const RETURN_AFTER_MS = 7 * DAY_MS

/** The fewest crossings that fold, on a run nothing has been kept out of. */
const FOLD_AT = 3

/** The fewest that fold after a peak or a return, which already says how the run began. */
const FOLD_AFTER_NOTE = 2

/**
 * A division as one number, lowest first: Iron IV is 0, Diamond I is 27, and
 * the apex tiers sit one above another after it. On a rated ladder, the colour.
 * Null when the reading names nothing on the ladder.
 */
function divisionOf(ladder: LadderId, reading: Pick<LadderReading, 'tier' | 'rank' | 'ratedTier'>): number | null {
  if (ladderScale(ladder) === 'rated') {
    const index = (RATED_TIERS as readonly string[]).indexOf(reading.ratedTier ?? '')
    return index < 0 ? null : index
  }

  const tier = (ALL_TIERS as readonly string[]).indexOf(reading.tier ?? '')
  if (tier < 0) return null
  // Master, Grandmaster and Challenger have no divisions of their own.
  const apex = tier - DIVISIONED_TIERS.length
  if (apex >= 0) return DIVISIONED_TIERS.length * DIVISIONS.length + apex

  const division = (DIVISIONS as readonly string[]).indexOf(reading.rank ?? '')
  return division < 0 ? null : tier * DIVISIONS.length + division
}

/**
 * The peaks and returns among the readings, keyed by the moment of the
 * promotion — which is also its milestone's, a milestone being the later of
 * its pair.
 *
 * Walks every reading rather than the milestones because what was held, and
 * until when, is a property of the readings: a milestone list says nothing
 * about a reset, nor where the range began.
 */
function notesOf(history: RankHistory, ladder: LadderId, seasons: Season[]): Map<number, MilestoneNote> {
  const readings: RankSnapshot[] = history.before ? [history.before, ...history.snapshots] : history.snapshots
  const notes = new Map<number, MilestoneNote>()

  // Everything held since the reset, and when each division was last left.
  // Nothing before the first reading is known but the season's best, so a
  // division not seen since is at least that long ago.
  const peak = history.peakBefore ? divisionOf(ladder, history.peakBefore) : null
  let best = peak ?? -Infinity
  const leftAt = new Map<number, number>()
  let knownSince = readings[0]?.capturedAt ?? 0

  let previous: RankSnapshot | null = null
  for (const reading of readings) {
    const here = divisionOf(ladder, reading)

    if (previous && resetsBetween(seasons, previous.capturedAt, reading.capturedAt)) {
      // A new ladder: climbing back is a first time again.
      best = -Infinity
      leftAt.clear()
      knownSince = reading.capturedAt
    } else if (previous) {
      const was = divisionOf(ladder, previous)
      if (was !== null && was !== here) leftAt.set(was, reading.capturedAt)

      if (here !== null && ladderMovementFor(ladder, previous, reading) === 'promotion') {
        if (here > best) {
          notes.set(reading.capturedAt, { kind: 'peak' })
        } else {
          const left = leftAt.get(here)
          const awayMs = reading.capturedAt - (left ?? knownSince)
          if (awayMs >= RETURN_AFTER_MS) {
            notes.set(reading.capturedAt, { kind: 'return', awayMs, atLeast: left === undefined })
          }
        }
      }
    }

    if (here !== null) best = Math.max(best, here)
    previous = reading
  }

  return notes
}

/** Whether a crossing carries on the back-and-forth the chain is in. */
function continues(chain: RankMilestone[], next: RankMilestone, ladder: LadderId, seasons: Season[]): boolean {
  const last = chain[chain.length - 1]
  if (!last || next.movement === last.movement) return false
  if (resetsBetween(seasons, last.capturedAt, next.capturedAt)) return false

  const here = divisionOf(ladder, next)
  if (here === null) return false
  return chain.length < 2 || here === divisionOf(ladder, chain[chain.length - 2])
}

/**
 * The milestones as the timeline draws them, newest first.
 *
 * Takes the history whole, not just its milestones: whether a promotion is a
 * peak or a return depends on the readings around it and the season's best
 * before them.
 */
export function milestoneTimeline(history: RankHistory, ladder: LadderId, seasons: Season[]): MilestoneEntry[] {
  const notes = notesOf(history, ladder, seasons)
  const entries: MilestoneEntry[] = []

  // The run of crossings back and forth that the current one belongs to, and
  // the part of it not yet written out.
  let chain: RankMilestone[] = []
  let pending: RankMilestone[] = []
  // Whether a peak or a return began this run and stands above it.
  let headed = false

  const flush = (): void => {
    const lower = pending.find((m) => m.movement === 'demotion')
    const upper = pending.find((m) => m.movement === 'promotion')
    if (pending.length >= (headed ? FOLD_AFTER_NOTE : FOLD_AT) && lower && upper) {
      entries.push({ kind: 'stretch', milestones: [...pending].reverse(), lower, upper })
    } else {
      for (const milestone of pending) entries.push({ kind: 'milestone', milestone, note: null })
    }
    pending = []
  }

  // Oldest first: a run is read in the order it was played.
  for (const milestone of [...history.milestones].reverse()) {
    if (!continues(chain, milestone, ladder, seasons)) {
      flush()
      chain = []
      headed = false
    }
    chain.push(milestone)

    const note = milestone.movement === 'promotion' ? (notes.get(milestone.capturedAt) ?? null) : null
    if (note) {
      flush()
      entries.push({ kind: 'milestone', milestone, note })
      headed = true
    } else {
      pending.push(milestone)
    }
  }
  flush()

  return entries.reverse()
}
