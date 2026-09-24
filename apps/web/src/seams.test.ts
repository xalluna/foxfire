import { describe, expect, it } from 'vitest'
import { browserFavoritesStore, browserHomeStore } from './client'
import { safeRedirect } from './routes/redirect'
import { inTabLock } from './session/locks'

describe('safeRedirect', () => {
  it('goes back to a page on this site', () => {
    expect(safeRedirect('/players/Faker-KR1?queue=all')).toBe('/players/Faker-KR1?queue=all')
    expect(safeRedirect('/matches/KR_7?player=Faker-KR1')).toBe('/matches/KR_7?player=Faker-KR1')
  })

  it('never leaves the site, however the address is dressed up', () => {
    expect(safeRedirect('https://evil.example')).toBe('/')
    expect(safeRedirect('//evil.example')).toBe('/')
    expect(safeRedirect('/\\evil.example')).toBe('/')
    expect(safeRedirect('/\t/evil.example')).toBe('/')
    expect(safeRedirect('javascript:alert(1)')).toBe('/')
  })

  it('does not send somebody who just signed in back to signing in', () => {
    expect(safeRedirect('/sign-in')).toBe('/')
    expect(safeRedirect('/sign-in?redirect=%2F')).toBe('/')
  })

  it('falls back when there is nothing usable', () => {
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect(42)).toBe('/')
    expect(safeRedirect('')).toBe('/')
  })
})

describe('inTabLock', () => {
  it('runs refreshes one after another, never two at once', async () => {
    const lock = inTabLock()
    const events: string[] = []
    const refresh = (name: string, ms: number) => async () => {
      events.push(`${name} start`)
      await new Promise((resolve) => setTimeout(resolve, ms))
      events.push(`${name} end`)
      return name
    }

    const results = await Promise.all([lock.run(refresh('a', 20)), lock.run(refresh('b', 1))])

    expect(results).toEqual(['a', 'b'])
    expect(events).toEqual(['a start', 'a end', 'b start', 'b end'])
  })

  it('carries on after one fails, and still tells the caller', async () => {
    const lock = inTabLock()

    await expect(lock.run(() => Promise.reject(new Error('refused')))).rejects.toThrow('refused')
    await expect(lock.run(async () => 'next')).resolves.toBe('next')
  })
})

describe('browserFavoritesStore', () => {
  it('keeps the favorites apart from the home account', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value)
    }

    browserHomeStore(storage).set('acc-1')
    browserFavoritesStore(storage).set('{"v":1,"players":[]}')

    expect(browserHomeStore(storage).get()).toBe('acc-1')
    expect(browserFavoritesStore(storage).get()).toBe('{"v":1,"players":[]}')
  })

  it('forgets quietly where the browser will not keep anything', () => {
    const store = browserFavoritesStore({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    })

    expect(() => store.set('{}')).not.toThrow()
    expect(store.get()).toBeNull()
  })
})

describe('browserHomeStore', () => {
  it('remembers which account this browser opens on', () => {
    const values = new Map<string, string>()
    const store = browserHomeStore({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value)
    })

    expect(store.get()).toBeNull()
    store.set('acc-1')
    expect(store.get()).toBe('acc-1')
  })

  it('forgets quietly where the browser will not keep anything', () => {
    const store = browserHomeStore({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    })

    expect(() => store.set('acc-1')).not.toThrow()
    expect(store.get()).toBeNull()
  })
})
