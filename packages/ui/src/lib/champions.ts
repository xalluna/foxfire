import type { ChampionStats } from '@foxfire/core'

/**
 * The champions somebody plays most, for the profile's short list.
 *
 * Ordered as the Champions page orders by games, ties and all — more games,
 * then the better win rate, then the champion id so the order is total — so
 * the five here are the page's first five and "More" continues the same list.
 */
export function mostPlayed(stats: readonly ChampionStats[], count: number): ChampionStats[] {
  const winRate = (row: ChampionStats): number => (row.games === 0 ? 0 : row.wins / row.games)

  return [...stats]
    .sort((a, b) => b.games - a.games || winRate(b) - winRate(a) || a.championId - b.championId)
    .slice(0, count)
}
