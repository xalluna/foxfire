import { useMemo } from 'react'
import type { MatchSummary } from '@shared/types'
import { killParticipation } from '../lib/matchStats'
import { POSITION_ORDER, isPosition, type Position } from '../lib/positions'

export interface ChampionForm {
  championId: number
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
}

export interface RecentSummary {
  games: number
  wins: number
  losses: number
  winRate: number | null
  avgKills: number
  avgDeaths: number
  avgAssists: number
  /** Null when every game in the window was deathless. */
  kdaRatio: number | null
  killParticipation: number | null
  topChampions: ChampionForm[]
  /** Positions with at least one game, most played first. */
  roles: Array<{ position: Position; games: number; share: number }>
}

/**
 * Aggregates the recent match window shown above the list.
 *
 * Computed in the renderer from the rows already fetched rather than through a
 * new IPC call: it needs nothing the enriched MatchSummary doesn't carry, and
 * deriving it from the same array guarantees the summary can never disagree
 * with the matches displayed directly beneath it.
 */
export function useRecentSummary(
  matches: MatchSummary[] | undefined,
  window = 20
): RecentSummary | null {
  return useMemo(() => {
    if (!matches || matches.length === 0) return null

    // Remakes are dropped before the window is taken, so recent form measures
    // games that were actually played rather than being diluted by voided ones.
    const played = matches.filter((m) => !m.isRemake)
    if (played.length === 0) return null

    const recent = played.slice(0, window)
    const games = recent.length

    const totals = recent.reduce(
      (acc, m) => {
        acc.wins += m.win ? 1 : 0
        acc.kills += m.kills
        acc.deaths += m.deaths
        acc.assists += m.assists
        const kp = killParticipation(m)
        if (kp !== null) {
          acc.kpSum += kp
          acc.kpCount += 1
        }
        return acc
      },
      { wins: 0, kills: 0, deaths: 0, assists: 0, kpSum: 0, kpCount: 0 }
    )

    const byChampion = new Map<number, ChampionForm>()
    for (const m of recent) {
      const entry = byChampion.get(m.championId) ?? {
        championId: m.championId,
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0
      }
      entry.games += 1
      entry.wins += m.win ? 1 : 0
      entry.kills += m.kills
      entry.deaths += m.deaths
      entry.assists += m.assists
      byChampion.set(m.championId, entry)
    }

    const byPosition = new Map<Position, number>()
    for (const m of recent) {
      // ARAM and Arena report no position; they simply don't contribute.
      if (isPosition(m.teamPosition)) {
        byPosition.set(m.teamPosition, (byPosition.get(m.teamPosition) ?? 0) + 1)
      }
    }
    const positionedGames = [...byPosition.values()].reduce((a, b) => a + b, 0)

    return {
      games,
      wins: totals.wins,
      losses: games - totals.wins,
      winRate: games > 0 ? totals.wins / games : null,
      avgKills: totals.kills / games,
      avgDeaths: totals.deaths / games,
      avgAssists: totals.assists / games,
      kdaRatio: totals.deaths > 0 ? (totals.kills + totals.assists) / totals.deaths : null,
      killParticipation: totals.kpCount > 0 ? totals.kpSum / totals.kpCount : null,
      topChampions: [...byChampion.values()]
        .sort((a, b) => b.games - a.games || b.wins - a.wins)
        .slice(0, 3),
      roles: POSITION_ORDER.filter((p) => byPosition.has(p))
        .map((position) => ({
          position,
          games: byPosition.get(position)!,
          share: byPosition.get(position)! / positionedGames
        }))
        .sort((a, b) => b.games - a.games)
    }
  }, [matches, window])
}
