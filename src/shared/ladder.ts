/**
 * Mapping tier + division + LP onto a single continuous number, so a rank graph
 * draws one smooth line across promotions instead of resetting at every tier.
 *
 * Lives in shared/ because both sides need it: main stamps `ladder_position`
 * onto every snapshot as it is written, and the renderer plots it.
 */

/** Tiers with four divisions each, lowest first. */
export const DIVISIONED_TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND'
] as const

/**
 * Master, Grandmaster and Challenger are decided by ladder cutoffs, not by LP
 * thresholds — a 500 LP Master and a 500 LP Grandmaster sit at the same point
 * on the ladder. They therefore share one scale, and the tier name only drives
 * colour and crest art, never the position.
 */
export const APEX_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'] as const

/** Lowest to highest, for comparing two ranks. */
export const ALL_TIERS = [...DIVISIONED_TIERS, ...APEX_TIERS] as const

/** Roman division suffixes, lowest first. */
export const DIVISIONS = ['IV', 'III', 'II', 'I'] as const

const LP_PER_DIVISION = 100
const LP_PER_TIER = DIVISIONS.length * LP_PER_DIVISION

/** Ladder position of Master 0 LP, which is also Diamond I 100 LP. */
export const APEX_BASE = DIVISIONED_TIERS.length * LP_PER_TIER

export interface RankLike {
  tier: string | null
  rank: string | null
  leaguePoints: number | null
}

function isApex(tier: string): boolean {
  return (APEX_TIERS as readonly string[]).includes(tier)
}

/**
 * A single number for tier + division + LP, or null when unranked.
 *
 * Iron IV 0 LP is 0 and Diamond I 100 LP is APEX_BASE, so the divisioned tiers
 * and the apex scale meet without a gap or an overlap.
 */
export function ladderPosition(entry: RankLike): number | null {
  const { tier, rank, leaguePoints } = entry
  if (!tier) return null
  const lp = leaguePoints ?? 0

  if (isApex(tier)) return APEX_BASE + lp

  const tierIndex = (DIVISIONED_TIERS as readonly string[]).indexOf(tier)
  if (tierIndex < 0) return null

  // Apex tiers always report rank "I"; the divisioned tiers must name a real one.
  const divisionIndex = (DIVISIONS as readonly string[]).indexOf(rank ?? '')
  if (divisionIndex < 0) return null

  return tierIndex * LP_PER_TIER + divisionIndex * LP_PER_DIVISION + lp
}

/**
 * The inverse of ladderPosition.
 *
 * Apex positions all report MASTER, since the real tier there depends on where
 * the server's cutoffs happen to sit and cannot be recovered from LP alone.
 */
export function rankAtPosition(position: number): {
  tier: string
  rank: string | null
  leaguePoints: number
} {
  const clamped = Math.max(0, Math.round(position))
  if (clamped >= APEX_BASE) {
    return { tier: 'MASTER', rank: 'I', leaguePoints: clamped - APEX_BASE }
  }

  const tierIndex = Math.floor(clamped / LP_PER_TIER)
  const withinTier = clamped - tierIndex * LP_PER_TIER
  const divisionIndex = Math.floor(withinTier / LP_PER_DIVISION)

  return {
    tier: DIVISIONED_TIERS[tierIndex],
    rank: DIVISIONS[divisionIndex],
    leaguePoints: withinTier - divisionIndex * LP_PER_DIVISION
  }
}

/**
 * Where a bare LP figure most likely places someone, given where they started.
 *
 * Typing a full rank for every game is three controls of mostly redundant work:
 * the tier and division are almost always either unchanged or one step away,
 * and which one is decided by the LP number itself. Every divisioned rank sits
 * at `k * 100 + lp` for some whole k, so the candidates for a typed LP are
 * fixed and the right one is simply the nearest — a game moves 15-30 LP, never
 * the 100+ that picking the wrong division would imply.
 *
 * Iron IV 88 from Iron IV 5 is a real, if unusual, 83 LP jump; there is nothing
 * below Iron IV for it to have come from, so the clamp keeps it there.
 *
 * Returns null when it cannot help: an unplaceable starting rank, or one in the
 * apex tiers, where LP runs past 100 unbounded and 75 means 75 rather than a
 * division boundary away.
 */
export function rankFromLeaguePoints(
  before: RankLike,
  leaguePoints: number
): { tier: string; rank: string | null; leaguePoints: number } | null {
  if (!before.tier || isApex(before.tier)) return null

  const from = ladderPosition(before)
  if (from === null) return null

  const divisions = Math.max(0, Math.round((from - leaguePoints) / LP_PER_DIVISION))
  return rankAtPosition(divisions * LP_PER_DIVISION + leaguePoints)
}

export type RankMovement = 'promotion' | 'demotion' | 'none'

/**
 * Whether the step between two snapshots crossed a tier or division boundary.
 *
 * Compares (tier, division) rather than ladder position, so gaining LP inside a
 * division is not a movement — and so Master to Grandmaster still registers as
 * a promotion even though the two share a ladder position.
 */
export function rankMovement(before: RankLike, after: RankLike): RankMovement {
  if (!before.tier || !after.tier) return 'none'

  const beforeTier = (ALL_TIERS as readonly string[]).indexOf(before.tier)
  const afterTier = (ALL_TIERS as readonly string[]).indexOf(after.tier)
  if (beforeTier < 0 || afterTier < 0) return 'none'
  if (afterTier !== beforeTier) return afterTier > beforeTier ? 'promotion' : 'demotion'

  const beforeDivision = (DIVISIONS as readonly string[]).indexOf(before.rank ?? '')
  const afterDivision = (DIVISIONS as readonly string[]).indexOf(after.rank ?? '')
  if (beforeDivision < 0 || afterDivision < 0 || afterDivision === beforeDivision) return 'none'

  return afterDivision > beforeDivision ? 'promotion' : 'demotion'
}

/** The tier a ladder position falls in — used to colour the graph's bands. */
export function tierAtPosition(position: number): string {
  if (position >= APEX_BASE) return 'MASTER'
  const index = Math.floor(position / LP_PER_TIER)
  return DIVISIONED_TIERS[Math.min(Math.max(index, 0), DIVISIONED_TIERS.length - 1)]
}

/** Ladder position where each divisioned tier begins, for drawing band edges. */
export function tierBandBoundaries(): Array<{ tier: string; start: number }> {
  const bands: Array<{ tier: string; start: number }> = DIVISIONED_TIERS.map((tier, index) => ({
    tier,
    start: index * LP_PER_TIER
  }))
  bands.push({ tier: 'MASTER', start: APEX_BASE })
  return bands
}
