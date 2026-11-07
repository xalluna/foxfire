import { isLadderId, LADDERS, type LadderId } from '@foxfire/core'

/*
 * What the League client says about rank, read into readings.
 *
 * The client's ranked stats cover both games: League's two ladders and TFT's
 * three, in one list. Every ladder a reading can be filed under is kept, which
 * is TFT's as well as League's — this used to drop RANKED_TFT* on the floor.
 */

/** One ladder as /lol-ranked/v1/current-ranked-stats lists it. */
export interface LcuRankedQueue {
  queueType: string
  tier?: string | null
  division?: string | null
  leaguePoints?: number | null
  wins?: number | null
  losses?: number | null
  /** Hyper Roll's colour, which the client sends instead of a tier. */
  ratedTier?: string | null
  ratedRating?: number | null
}

/** A reading as the League client reports it, on any game's ladder. */
export interface LcuRankReading {
  queueType: LadderId
  tier: string | null
  rank: string | null
  leaguePoints: number | null
  wins: number | null
  losses: number | null
  /** Hyper Roll's, where tier, rank and LP are null. */
  ratedTier?: string | null
  ratedRating?: number | null
}

/**
 * The client's word for "not applicable", folded to null.
 *
 * "NA" in tier and division — an unranked queue reports tier "NA", and the apex
 * tiers division "NA" — and "NONE" in a rated tier nobody has played into.
 * Stored verbatim either would read as a real rank of that name.
 */
export function normaliseRankField(value: string | null | undefined): string | null {
  return !value || value === 'NA' || value === 'NONE' ? null : value
}

/**
 * Every ladder the player stands on, as readings.
 *
 * An unranked ladder has no position, so a reading of it would be an
 * unplottable row saying nothing: recording starts at placement, or for Hyper
 * Roll at the first colour.
 */
export function readingsFromRankedStats(stats: { queues?: LcuRankedQueue[] | null } | null | undefined): LcuRankReading[] {
  const readings: LcuRankReading[] = []

  for (const queue of stats?.queues ?? []) {
    if (!isLadderId(queue.queueType)) continue

    if (LADDERS[queue.queueType].scale === 'rated') {
      const ratedTier = normaliseRankField(queue.ratedTier)
      if (ratedTier === null || typeof queue.ratedRating !== 'number') continue
      readings.push({
        queueType: queue.queueType,
        tier: null,
        rank: null,
        leaguePoints: null,
        wins: queue.wins ?? null,
        losses: queue.losses ?? null,
        ratedTier,
        ratedRating: queue.ratedRating
      })
      continue
    }

    const tier = normaliseRankField(queue.tier)
    if (!tier) continue
    readings.push({
      queueType: queue.queueType,
      tier,
      rank: normaliseRankField(queue.division),
      leaguePoints: queue.leaguePoints ?? null,
      wins: queue.wins ?? null,
      losses: queue.losses ?? null
    })
  }

  return readings
}
