import { describe, expect, it } from 'vitest'
import type { Account, FavoritePlayer, LeagueEntry, PlayerSearchResult } from '../types'
import {
  FAVORITES_LIMIT,
  addFavorite,
  parseFavorites,
  refreshFavorites,
  removeFavorite,
  serializeFavorites,
  soloEntryOf
} from './favorites'

function player(id: string, patch: Partial<Account> = {}, soloEntry: LeagueEntry | null = null): PlayerSearchResult {
  return {
    account: {
      id,
      puuid: `p-${id}`,
      gameName: `Player${id}`,
      tagLine: 'NA1',
      platform: 'na1',
      regionalRoute: 'americas',
      summonerId: null,
      profileIconId: 1,
      summonerLevel: 100,
      isHomeAccount: false,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      isMine: false,
      ownerUsername: null,
      ...patch
    },
    soloEntry
  }
}

function entry(tier: string, leaguePoints: number, fetchedAt: string): LeagueEntry {
  return { queueType: 'RANKED_SOLO_5x5', tier, rank: 'II', leaguePoints, wins: 10, losses: 10, fetchedAt }
}

const ids = (list: readonly FavoritePlayer[]) => list.map((f) => f.account.id)

function fullList(): FavoritePlayer[] {
  let list: FavoritePlayer[] = []
  for (let i = 0; i < FAVORITES_LIMIT; i++) {
    const outcome = addFavorite(list, player(String(i)), `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`)
    list = outcome.favorites
  }
  return list
}

describe('addFavorite', () => {
  it('puts the newest star first', () => {
    const one = addFavorite([], player('a'), '2026-09-01T00:00:00Z').favorites
    const two = addFavorite(one, player('b'), '2026-09-02T00:00:00Z').favorites

    expect(ids(two)).toEqual(['b', 'a'])
  })

  it('keeps somebody starred twice where they were, with the newer copy', () => {
    const list = addFavorite(
      addFavorite([], player('a'), '2026-09-01T00:00:00Z').favorites,
      player('b'),
      '2026-09-02T00:00:00Z'
    ).favorites

    const again = addFavorite(list, player('a', { gameName: 'Renamed' }), '2026-09-03T00:00:00Z')

    expect(again.ok).toBe(true)
    expect(ids(again.favorites)).toEqual(['b', 'a'])
    expect(again.favorites[1].account.gameName).toBe('Renamed')
    expect(again.favorites[1].addedAt).toBe('2026-09-01T00:00:00Z')
  })

  it('refuses an eleventh rather than dropping somebody', () => {
    const list = fullList()
    const outcome = addFavorite(list, player('new'), '2026-09-30T00:00:00Z')

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toBe('full')
    expect(ids(outcome.favorites)).toEqual(ids(list))
  })

  it('still takes a newer copy of somebody already in a full list', () => {
    const outcome = addFavorite(fullList(), player('3', { summonerLevel: 300 }), '2026-09-30T00:00:00Z')

    expect(outcome.ok).toBe(true)
    expect(outcome.favorites.find((f) => f.account.id === '3')?.account.summonerLevel).toBe(300)
  })

  it('never keeps a copy that says "home"', () => {
    const [favorite] = addFavorite([], player('a', { isHomeAccount: true }), '2026-09-01T00:00:00Z').favorites
    expect(favorite.account.isHomeAccount).toBe(false)
  })
})

describe('removeFavorite', () => {
  it('takes one player out and leaves the order', () => {
    expect(ids(removeFavorite(fullList(), '5'))).toEqual(['9', '8', '7', '6', '4', '3', '2', '1', '0'])
  })
})

describe('refreshFavorites', () => {
  const starred = addFavorite([], player('a', {}, entry('SILVER', 10, '2026-09-10T00:00:00Z')), '2026-09-05T00:00:00Z')
    .favorites

  it('takes a newer copy, keeping when it was starred', () => {
    const fresh = player('a', { updatedAt: '2026-09-20T00:00:00Z' }, entry('GOLD', 4, '2026-09-20T00:00:00Z'))
    const refreshed = refreshFavorites(starred, [fresh])

    expect(refreshed?.[0].soloEntry?.tier).toBe('GOLD')
    expect(refreshed?.[0].addedAt).toBe('2026-09-05T00:00:00Z')
  })

  it('is null when nobody in it went past', () => {
    expect(refreshFavorites(starred, [player('b')])).toBeNull()
  })

  it('is null when what went past draws the same', () => {
    const same = player('a', { updatedAt: '2026-09-20T00:00:00Z' }, entry('SILVER', 10, '2026-09-20T00:00:00Z'))
    expect(refreshFavorites(starred, [same])).toBeNull()
  })

  it('does not let an older answer undo a newer one', () => {
    const older = player('a', { updatedAt: '2026-08-01T00:00:00Z' }, entry('IRON', 0, '2026-08-01T00:00:00Z'))
    expect(refreshFavorites(starred, [older])).toBeNull()
  })
})

describe('soloEntryOf', () => {
  it('is the solo queue entry, or null', () => {
    const flex: LeagueEntry = { ...entry('GOLD', 1, ''), queueType: 'RANKED_FLEX_SR' }
    const solo = entry('SILVER', 2, '')

    expect(soloEntryOf([flex, solo])).toBe(solo)
    expect(soloEntryOf([flex])).toBeNull()
  })
})

describe('parseFavorites', () => {
  it('reads back what was written', () => {
    const list = fullList()
    expect(parseFavorites(serializeFavorites(list))).toEqual(list)
  })

  it('is empty for nothing stored, or something that is not a list', () => {
    expect(parseFavorites(null)).toEqual([])
    expect(parseFavorites('{not json')).toEqual([])
    expect(parseFavorites('{"v":1,"players":"nope"}')).toEqual([])
    expect(parseFavorites('null')).toEqual([])
  })

  it('drops what it cannot read and the second of a duplicate, and comes back newest first', () => {
    const a = { ...player('a'), addedAt: '2026-09-01T00:00:00Z' }
    const b = { ...player('b'), addedAt: '2026-09-02T00:00:00Z' }
    const raw = JSON.stringify({
      v: 1,
      players: [a, { account: { id: 'x' } }, b, { ...a, addedAt: '2026-09-09T00:00:00Z' }, 42, { ...b, addedAt: 'whenever' }]
    })

    expect(ids(parseFavorites(raw))).toEqual(['b', 'a'])
  })

  it('never hands back more than the limit, however many were stored', () => {
    const many = Array.from({ length: FAVORITES_LIMIT + 5 }, (_, i) => ({
      ...player(String(i)),
      addedAt: new Date(Date.UTC(2026, 8, i + 1)).toISOString()
    }))

    expect(parseFavorites(JSON.stringify({ v: 1, players: many }))).toHaveLength(FAVORITES_LIMIT)
  })
})
