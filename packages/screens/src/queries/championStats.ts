import { useQuery } from '@tanstack/react-query'
import {
  parseSeasonRange,
  seasonRange,
  type Account,
  type ChampionStats,
  type RankRange,
  type Season
} from '@foxfire/core'
import { useClient } from '../client/context'
import { queryKeys } from './keys'

/**
 * The period a champion table opens on: the one picked, or else the newest
 * ranked year that actually has games.
 *
 * That is not always the calendar year — in January, before the first game of
 * the new one, last year is the only thing worth opening on — and it is not
 * known until the periods have loaded, which is why the stats wait for them.
 */
export function championRangeFor(picked: RankRange | null, periods: Season[] | undefined): RankRange {
  if (picked !== null) return picked
  const newest = periods?.[0]
  return newest !== undefined ? seasonRange(newest.id) : 'all'
}

export interface ChampionStatsView {
  /** Seasons with data, newest first; undefined until they load. */
  periods: Season[] | undefined
  range: RankRange
  /** The season `range` names, or null for "all" and the relative windows. */
  season: Season | null
  stats: ChampionStats[] | undefined
  loading: boolean
}

/**
 * One account's champions for a queue and a period, opening where the
 * Champions page does.
 *
 * Shared by that page and the profile's top five, so the two ask the same
 * question under the same key: "More" from the profile lands on numbers that
 * are already cached, and always the same ones.
 */
export function useChampionStats(
  account: Account,
  queueId: number | null,
  picked: RankRange | null
): ChampionStatsView {
  const client = useClient()

  const { data: periods } = useQuery({
    queryKey: queryKeys.rankPeriods(account.id),
    queryFn: () => client.rank.periods(account.id)
  })

  const range = championRangeFor(picked, periods)
  const season = (periods ?? []).find((s) => s.id === parseSeasonRange(range)) ?? null

  const stats = useQuery({
    // Both the queue and the period belong in the key, or switching either
    // would serve the previous selection's cached stats.
    queryKey: queryKeys.championStats(account.id, queueId, range),
    queryFn: () => client.champions.stats(account.id, queueId, range),
    // Held until the periods land, so nothing flashes a blended all-time
    // number on its way to the year it is going to show.
    enabled: periods !== undefined
  })

  return {
    periods,
    range,
    season,
    stats: stats.data,
    loading: periods === undefined || stats.isLoading
  }
}
