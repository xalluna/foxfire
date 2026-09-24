import { describe, expect, it } from 'vitest'
import type { Account, FavoritePlayer, PlayerSearchResult } from '@foxfire/core'
import { searchShortcutLabel, searchView, type SearchViewInput } from './searchView'

const player = (id: string): PlayerSearchResult => ({
  account: { id, gameName: `Player${id}`, tagLine: 'NA1' } as Account,
  soloEntry: null
})
const favorite = (id: string): FavoritePlayer => ({ ...player(id), addedAt: '2026-09-24T00:00:00Z' })

function input(patch: Partial<SearchViewInput>): SearchViewInput {
  return {
    query: '',
    asked: '',
    favorites: [favorite('f')],
    yours: { players: [player('y')], loading: false },
    suggestions: { players: undefined, stale: false, failed: false },
    ...patch
  }
}

const keys = (view: ReturnType<typeof searchView>) => view.sections.map((s) => s.key)

describe('searchView', () => {
  it('opens on favorites and then your accounts', () => {
    const view = searchView(input({}))

    expect(keys(view)).toEqual(['favorites', 'yours'])
    expect(view.status).toBeNull()
  })

  it('has no favorites section where nobody can be starred', () => {
    expect(keys(searchView(input({ favorites: null })))).toEqual(['yours'])
  })

  it('keeps the lists unfiltered for one or two characters, and says why', () => {
    const view = searchView(input({ query: 'ab', asked: 'ab' }))

    expect(keys(view)).toEqual(['favorites', 'yours'])
    expect(view.sections[0].players).toHaveLength(1)
    expect(view.status).toBe('Type 3+ characters to search')
  })

  it('counts what is typed without the spaces around it', () => {
    expect(keys(searchView(input({ query: '  ab  ' })))).toEqual(['favorites', 'yours'])
  })

  it('shows the suggestions from three characters on', () => {
    const view = searchView(
      input({ query: 'fak', asked: 'fak', suggestions: { players: [player('1')], stale: false, failed: false } })
    )

    expect(keys(view)).toEqual(['results'])
    expect(view.sections[0].label).toBeNull()
    expect(view.status).toBeNull()
  })

  it('keeps the last suggestions on screen while the next are asked', () => {
    const view = searchView(
      input({ query: 'fake', asked: 'fak', suggestions: { players: [player('1')], stale: true, failed: false } })
    )

    expect(keys(view)).toEqual(['results'])
  })

  it('says it is searching before the first answer, rather than that nobody matched', () => {
    expect(searchView(input({ query: 'fak', asked: '' })).status).toBe('Searching…')
    expect(
      searchView(input({ query: 'fake', asked: 'fak', suggestions: { players: [], stale: true, failed: false } }))
        .status
    ).toBe('Searching…')
  })

  it('says nobody matched only once the answer is for what is typed', () => {
    const view = searchView(
      input({ query: 'zzz', asked: 'zzz', suggestions: { players: [], stale: false, failed: false } })
    )

    expect(view.sections).toEqual([])
    expect(view.status).toBe('No player named “zzz” on this server')
  })

  it('says so when the search failed', () => {
    const view = searchView(
      input({ query: 'zzz', asked: 'zzz', suggestions: { players: undefined, stale: false, failed: true } })
    )

    expect(view.status).toBe('Could not search just now.')
  })
})

describe('searchShortcutLabel', () => {
  it('is Command on a Mac and Ctrl everywhere else', () => {
    expect(searchShortcutLabel('MacIntel')).toBe('⌘K')
    expect(searchShortcutLabel('Win32')).toBe('Ctrl K')
    expect(searchShortcutLabel('')).toBe('Ctrl K')
  })
})
