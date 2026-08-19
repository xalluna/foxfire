/**
 * Working out which stored match a recording belongs to.
 *
 * A live game carries no match id anywhere — not in the Live Client payload,
 * not in the client's gameflow session — so the link has to be made after the
 * fact, once match-v5 publishes minutes later.
 *
 * Matching on end time alone is not good enough. Two games finishing within a
 * few minutes of each other is an ordinary evening if somebody is playing on a
 * second account, or if the app was closed and a backfill lands several games
 * at once. The roster is what actually identifies a game: ten champions, one of
 * them yours, is close to unique.
 *
 * Pure — no DB — so all of that is testable without playing anything.
 */

/** A stored match a recording could belong to. */
export interface MatchCandidate {
  matchId: string
  /** Epoch milliseconds. */
  gameCreation: number
  /** Seconds. */
  gameDuration: number
  /** Every participant's champion, in any order. */
  championIds: number[]
  /** The tracked account's champion in that match. */
  selfChampionId: number | null
  /** Already claimed by another recording, so it cannot be claimed again. */
  taken: boolean
}

export interface ReplayFingerprint {
  /** Epoch milliseconds when recording began. */
  startedAt: number
  /** Epoch milliseconds when recording stopped, if it did. */
  endedAt: number | null
  /** Champion ids read off the live scoreboard. */
  roster: number[]
  selfChampionId: number | null
}

/**
 * How much of the roster has to line up.
 *
 * Not all of it: the live scoreboard names champions and the manifest turns
 * those names into ids, so a champion released since the last asset fetch comes
 * back unresolved. Eight of ten still identifies a game beyond doubt, and
 * demanding ten would fail every game containing a brand new champion.
 */
const MIN_ROSTER_RATIO = 0.8

/**
 * How far apart the two clocks may be.
 *
 * Riot's gameCreation and the local clock are different machines, and a
 * recording starts minutes after gameCreation and ends around gameDuration
 * later. An hour is far looser than any of that drift and still tight enough
 * that yesterday's game on the same champions cannot be claimed.
 */
const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000

/** Size of the multiset intersection — champions can repeat across the two teams. */
function overlap(a: readonly number[], b: readonly number[]): number {
  const counts = new Map<number, number>()
  for (const id of a) counts.set(id, (counts.get(id) ?? 0) + 1)

  let shared = 0
  for (const id of b) {
    const left = counts.get(id) ?? 0
    if (left > 0) {
      counts.set(id, left - 1)
      shared += 1
    }
  }
  return shared
}

/** Roughly when the game the recording covers finished, on the local clock. */
function replayEnd(replay: ReplayFingerprint): number {
  return replay.endedAt ?? replay.startedAt
}

/** Roughly when a stored match finished, on Riot's clock. */
function candidateEnd(candidate: MatchCandidate): number {
  return candidate.gameCreation + candidate.gameDuration * 1000
}

export interface BindingResult {
  matchId: string
  /** Fraction of the roster that lined up, for logging a near miss. */
  confidence: number
}

/**
 * The best match for a recording, or null if nothing is close enough.
 *
 * Returning null is a perfectly normal outcome: a Practice Tool game produces
 * no match-v5 match at all, so no candidate can ever exist for it.
 */
export function findMatchForReplay(
  replay: ReplayFingerprint,
  candidates: readonly MatchCandidate[]
): BindingResult | null {
  if (replay.roster.length === 0) return null

  const end = replayEnd(replay)
  let best: BindingResult | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    if (candidate.taken) continue

    // The champion you played is the cheapest and strongest single check: it
    // rules out the other games in the same lobby window immediately.
    if (
      replay.selfChampionId !== null &&
      candidate.selfChampionId !== null &&
      replay.selfChampionId !== candidate.selfChampionId
    ) {
      continue
    }

    const distance = Math.abs(candidateEnd(candidate) - end)
    if (distance > MAX_CLOCK_SKEW_MS) continue

    const shared = overlap(replay.roster, candidate.championIds)
    const ratio = shared / Math.max(replay.roster.length, candidate.championIds.length)
    if (ratio < MIN_ROSTER_RATIO) continue

    // Ranked by how well the rosters agree, and only then by which finished
    // closest — time is the weaker signal and must not outvote the roster.
    if (best === null || ratio > best.confidence || (ratio === best.confidence && distance < bestDistance)) {
      best = { matchId: candidate.matchId, confidence: ratio }
      bestDistance = distance
    }
  }

  return best
}

/**
 * How long to keep trying before calling a recording unmatched.
 *
 * Comfortably past the last postGameSync retry at ten minutes, so giving up is
 * a real conclusion rather than a race with the sync that would have bound it.
 */
export const BIND_GIVE_UP_MS = 30 * 60 * 1000

export function shouldGiveUpBinding(replay: ReplayFingerprint, now: number): boolean {
  return now - replayEnd(replay) > BIND_GIVE_UP_MS
}

/**
 * How long a recording already given up on stays worth reconsidering.
 *
 * Because the give-up above answers "has enough time passed", not "did we ever
 * actually get to look". A key that expired overnight fails every sync until a
 * new one is pasted, by which point every recording made in the meantime is
 * hours past the deadline — and the match it was waiting for lands seconds
 * later. Written off is therefore a state to revisit, not a verdict.
 *
 * A week covers being away from the app that long and still bounds how far back
 * a sync has to look for candidates.
 */
export const BIND_RETRY_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
