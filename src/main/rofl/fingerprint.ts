/**
 * Finding the match a renamed replay came from.
 *
 * Almost every replay Foxfire ingests skips this entirely: Riot names its files
 * after the game, so `filename.ts` answers the question outright. This module
 * exists for the one case that cannot — a file somebody added by hand after
 * renaming it, or moving it out of a backup that lost the original name.
 *
 * The .rofl header carries the whole scoreboard, so the signal available here
 * is strong: ten champions and a game length. That is the same shape of
 * evidence `capture/matchBinding.ts` uses to bind a recording, and the same
 * ordering applies — the roster decides, and time only breaks ties. The
 * difference is that a recording's clock is trustworthy and a hand-added file's
 * is not, so no time gate is applied at all here. A replay restored from a
 * backup has a file date that says nothing about when the game was played.
 *
 * Pure — no DB, no filesystem — so it is testable without a replay to hand.
 */

/** A stored match a replay could belong to. */
export interface FingerprintCandidate {
  matchId: string
  /** Seconds. */
  gameDuration: number
  /** Every participant's champion name, in any order, as Riot spells them. */
  championNames: string[]
  /** Already claimed by another replay, so it cannot be claimed again. */
  taken: boolean
}

export interface ReplayFingerprint {
  /** Champion names from the header's scoreboard. */
  championNames: string[]
  /** Seconds, from the header. Null when the header did not carry one. */
  durationSeconds: number | null
}

export interface FingerprintResult {
  matchId: string
  /** How much of the roster agreed, 0..1. Logged, so a near miss is diagnosable. */
  confidence: number
}

/**
 * How much of the roster has to line up.
 *
 * Held at the same 0.8 the recording matcher uses, for the same reason and one
 * more: the header spells champions the way the game's asset files do
 * ("MonkeyKing", "Fiddlesticks") and match-v5 mostly agrees, but the two have
 * disagreed before on champions whose in-game name differs from their display
 * name. Eight of ten still identifies a game beyond doubt.
 */
const MIN_ROSTER_RATIO = 0.8

/**
 * How far apart two game lengths may be and still be the same game.
 *
 * The header measures the replay's own recorded length and match-v5 measures
 * the game, and the two disagree by a few seconds over when the game "ended".
 * A minute is far past that drift and still tight enough to separate two games
 * on the same ten champions, which is the only case this gate has to survive.
 */
const MAX_DURATION_DRIFT_S = 60

export function findMatchForReplay(
  replay: ReplayFingerprint,
  candidates: readonly FingerprintCandidate[]
): FingerprintResult | null {
  // Without a roster there is nothing to match on, and guessing from game
  // length alone would be worse than admitting we do not know.
  if (replay.championNames.length === 0) return null

  let best: FingerprintResult | null = null
  let bestDrift = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    if (candidate.taken) continue

    const drift =
      replay.durationSeconds === null
        ? 0
        : Math.abs(candidate.gameDuration - replay.durationSeconds)
    if (drift > MAX_DURATION_DRIFT_S) continue

    const ratio = rosterRatio(replay.championNames, candidate.championNames)
    if (ratio < MIN_ROSTER_RATIO) continue

    // Roster first, drift only as a tiebreak: game length is the weaker signal
    // and must not outvote agreement on who was in the game.
    if (
      best === null ||
      ratio > best.confidence ||
      (ratio === best.confidence && drift < bestDrift)
    ) {
      best = { matchId: candidate.matchId, confidence: ratio }
      bestDrift = drift
    }
  }

  return best
}

/**
 * Multiset overlap, so a champion picked on both teams counts twice.
 *
 * Comparison is case-insensitive because the two sources capitalise
 * inconsistently, and the denominator is the longer of the two rosters so a
 * short roster cannot score a perfect ratio against a full one.
 */
function rosterRatio(
  left: readonly string[],
  right: readonly string[]
): number {
  const pool = new Map<string, number>()
  for (const name of right) {
    const key = name.toLowerCase()
    pool.set(key, (pool.get(key) ?? 0) + 1)
  }

  let shared = 0
  for (const name of left) {
    const key = name.toLowerCase()
    const remaining = pool.get(key) ?? 0
    if (remaining > 0) {
      pool.set(key, remaining - 1)
      shared++
    }
  }

  const width = Math.max(left.length, right.length)
  return width === 0 ? 0 : shared / width
}
