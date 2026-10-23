/**
 * Hyper Roll's ladder, which is not League's.
 *
 * Ranked TFT and Double Up climb Iron IV to Challenger like League does, and
 * the arithmetic in ladder.ts places them. Hyper Roll is measured by a rating
 * — a number that only goes up and down — and a coloured tier the rating falls
 * in, with no divisions and no LP. Its ladder position is the rating itself,
 * so a graph of it is a graph of the number, banded by tier.
 *
 * The floors are Riot's, as of Set 18, and are the one thing here that can go
 * stale: Riot has moved them before. They only colour the bands and name a
 * tier a reading forgot to; every reading carries its own tier.
 */

import type { LadderScale } from '../games/ladders'
import { LADDERS, type LadderId } from '../games/ladders'
import { ladderPosition, rankMovement, type RankLike, type RankMovement } from './ladder'

/** Lowest first. */
export const RATED_TIERS = ['GRAY', 'GREEN', 'BLUE', 'PURPLE', 'ORANGE'] as const
export type RatedTier = (typeof RATED_TIERS)[number]

/** The rating each tier starts at. */
export const RATED_TIER_FLOORS: Readonly<Record<RatedTier, number>> = {
  GRAY: 0,
  GREEN: 1400,
  BLUE: 2600,
  PURPLE: 3400,
  ORANGE: 4200
}

export function isRatedTier(value: unknown): value is RatedTier {
  return typeof value === 'string' && (RATED_TIERS as readonly string[]).includes(value)
}

/** The tier a rating falls in. */
export function ratedTierAt(rating: number): RatedTier {
  let tier: RatedTier = 'GRAY'
  for (const candidate of RATED_TIERS) {
    if (rating >= RATED_TIER_FLOORS[candidate]) tier = candidate
  }
  return tier
}

/** Where each rated tier begins, for drawing band edges. */
export function ratedBandBoundaries(): Array<{ tier: string; start: number }> {
  return RATED_TIERS.map((tier) => ({ tier, start: RATED_TIER_FLOORS[tier] }))
}

/** Whether the step between two rated readings changed tier. */
export function ratedMovement(before: string | null, after: string | null): RankMovement {
  if (!isRatedTier(before) || !isRatedTier(after) || before === after) return 'none'
  return RATED_TIERS.indexOf(after) > RATED_TIERS.indexOf(before) ? 'promotion' : 'demotion'
}

/** A reading as either kind of ladder places it. */
export interface LadderReading extends RankLike {
  ratedTier?: string | null
  ratedRating?: number | null
}

/** The scale a ladder measures on. */
export function ladderScale(ladder: LadderId): LadderScale {
  return LADDERS[ladder].scale
}

/**
 * One number for wherever a reading stands, on whichever ladder.
 *
 * A divisioned ladder folds tier, division and LP the way League's always has.
 * A rated one is its rating, which is already one number. Null for a reading
 * of nobody — unranked, or a rated reading with no rating.
 */
export function ladderPositionFor(ladder: LadderId, reading: LadderReading): number | null {
  if (ladderScale(ladder) === 'rated') return reading.ratedRating ?? null
  return ladderPosition(reading)
}

/** Whether the step between two readings on one ladder crossed a boundary. */
export function ladderMovementFor(ladder: LadderId, before: LadderReading, after: LadderReading): RankMovement {
  if (ladderScale(ladder) === 'rated') return ratedMovement(before.ratedTier ?? null, after.ratedTier ?? null)
  return rankMovement(before, after)
}
