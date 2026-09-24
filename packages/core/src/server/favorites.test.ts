import { describe, expect, it, vi } from 'vitest'
import type { Account, PlayerSearchResult } from '../types'
import { FAVORITES_LIMIT } from '../rules/favorites'
import { favoritesOver } from './favorites'

function player(id: string, updatedAt = '2026-09-01T00:00:00Z'): PlayerSearchResult {
  return {
    account: { id, gameName: `Player${id}`, tagLine: 'NA1', updatedAt, summonerLevel: 1 } as Account,
    soloEntry: null
  }
}

function memoryStore() {
  let value: string | null = null
  return { get: vi.fn(() => value), set: vi.fn((next: string) => (value = next)) }
}

describe('favoritesOver', () => {
  it('remembers a star in the store', async () => {
    const store = memoryStore()
    const favorites = favoritesOver(store, () => '2026-09-24T00:00:00Z')

    await favorites.add(player('a'))

    expect((await favoritesOver(store).list()).map((f) => f.account.id)).toEqual(['a'])
  })

  it('writes nothing when a full list refuses a star', async () => {
    const store = memoryStore()
    let day = 0
    const favorites = favoritesOver(store, () => new Date(Date.UTC(2026, 8, ++day)).toISOString())
    for (let i = 0; i < FAVORITES_LIMIT; i++) await favorites.add(player(String(i)))
    store.set.mockClear()

    const outcome = await favorites.add(player('eleven'))

    expect(outcome.ok).toBe(false)
    expect(store.set).not.toHaveBeenCalled()
  })

  it('writes nothing when a refresh finds everybody as they were, or removes nobody', async () => {
    const store = memoryStore()
    const favorites = favoritesOver(store)
    await favorites.add(player('a'))
    store.set.mockClear()

    await favorites.refresh([player('a'), player('b')])
    await favorites.remove('b')

    expect(store.set).not.toHaveBeenCalled()
  })

  it('writes a refresh that changed somebody', async () => {
    const store = memoryStore()
    const favorites = favoritesOver(store)
    await favorites.add(player('a'))

    const renamed = { ...player('a', '2026-09-20T00:00:00Z') }
    renamed.account = { ...renamed.account, gameName: 'Renamed' }
    const list = await favorites.refresh([renamed])

    expect(list[0].account.gameName).toBe('Renamed')
    expect((await favorites.list())[0].account.gameName).toBe('Renamed')
  })
})
