import { describe, expect, it } from 'vitest'
import type { ChampionStats } from '@foxfire/core'
import { mostPlayed } from './champions'

const row = (championId: number, games: number, wins: number): ChampionStats => ({
  championId,
  games,
  wins,
  kills: 0,
  deaths: 0,
  assists: 0,
  cs: 0,
  damageToChampions: 0,
  durationSeconds: 0,
  damageShare: null,
  killParticipation: null
})

describe('mostPlayed', () => {
  it('takes the most games first', () => {
    const top = mostPlayed([row(1, 3, 1), row(2, 12, 6), row(3, 7, 7)], 2)
    expect(top.map((r) => r.championId)).toEqual([2, 3])
  })

  it('breaks a tie on games by win rate, then by champion', () => {
    const top = mostPlayed([row(9, 4, 1), row(5, 4, 3), row(7, 4, 1)], 3)
    expect(top.map((r) => r.championId)).toEqual([5, 7, 9])
  })

  it('leaves the list it was given alone', () => {
    const stats = [row(1, 1, 0), row(2, 5, 2)]
    mostPlayed(stats, 5)
    expect(stats.map((r) => r.championId)).toEqual([1, 2])
  })
})
