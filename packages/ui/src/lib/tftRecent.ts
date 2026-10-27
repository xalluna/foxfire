import type { TftMatchSummary } from '@foxfire/core'
import { DOUBLE_UP_QUEUE_ID, activeTraits, countedPlacement, isTopHalf } from '@foxfire/core'

/** A trait somebody kept playing, and how it went. */
export interface TftSynergy {
  name: string
  games: number
  averagePlacement: number
}

/** The last stretch of TFT, as the block above the history reads it. */
export interface TftRecentSummary {
  games: number
  /** Top four — or a top-two team in Double Up — over all of them. */
  topRate: number
  averagePlacement: number
  firsts: number
  /** Newest first, each with how far its good half reached — four, or two teams. */
  finishes: Array<{ matchId: string; placement: number; top: number }>
  /** The traits switched on most often, best average first among equals. */
  synergies: TftSynergy[]
}

/**
 * The recent window, from the rows already loaded — as League's is, so the
 * block can never disagree with the list beneath it. Counts the place a ladder
 * counts: the team's in Double Up, the player's own everywhere else.
 */
export function summariseTftRecent(
  rows: TftMatchSummary[] | undefined,
  window = 20
): TftRecentSummary | null {
  if (!rows || rows.length === 0) return null

  const recent = rows.slice(0, window)
  const counted = recent.map((r) => countedPlacement(r, r.queueId))

  const byTrait = new Map<string, { games: number; total: number }>()
  recent.forEach((row, i) => {
    for (const trait of activeTraits(row.traits)) {
      const entry = byTrait.get(trait.name) ?? { games: 0, total: 0 }
      entry.games += 1
      entry.total += counted[i]!
      byTrait.set(trait.name, entry)
    }
  })

  return {
    games: recent.length,
    topRate: recent.filter((r) => isTopHalf(r, r.queueId)).length / recent.length,
    averagePlacement: counted.reduce((a, b) => a + b, 0) / recent.length,
    firsts: counted.filter((c) => c === 1).length,
    finishes: recent.map((r, i) => ({
      matchId: r.matchId,
      placement: counted[i]!,
      top: r.queueId === DOUBLE_UP_QUEUE_ID && r.teamPlacement !== null ? 2 : 4
    })),
    synergies: [...byTrait.entries()]
      .map(([name, { games, total }]) => ({ name, games, averagePlacement: total / games }))
      .sort((a, b) => b.games - a.games || a.averagePlacement - b.averagePlacement || a.name.localeCompare(b.name))
      .slice(0, 3)
  }
}
