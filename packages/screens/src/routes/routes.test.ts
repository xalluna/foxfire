import { describe, expect, it } from 'vitest'
import { paths } from '@foxfire/core/routes'
import {
  queueIdFrom,
  queueSearchFor,
  queueTypeFrom,
  rankQueueSearchFor,
  rankRangeSearchFor,
  validateChampionsSearch,
  validateDashboardSearch,
  validateLpEditorSearch,
  validateMatchSearch,
  validateRankSearch,
  validateRecordingSearch,
  validateTftRankSearch,
  validateTftSearch,
  tftLadderFrom,
  tftQueueIdFrom,
  tftQueueSearchFor,
  tftRankQueueSearchFor,
  type DashboardSearch
} from './params'
import { rememberSearch } from './rememberSearch'
import { parseSearch, stringifySearch } from './serialize'

const FAKER = { gameName: 'Faker', tagLine: 'KR1' }

/** The query string of a path core builds, as the router would parse it. */
function searchOf(path: string): Record<string, unknown> {
  return parseSearch(path.slice(path.indexOf('?')))
}

describe('search validators', () => {
  it('reads what a player page keeps in its URL', () => {
    expect(validateDashboardSearch({ queue: 450, match: 'NA1_1' })).toEqual({ queue: 450, match: 'NA1_1' })
    expect(validateDashboardSearch({ queue: 'all' })).toEqual({ queue: 'all' })
    expect(validateChampionsSearch({ queue: 440, range: 'season:3' })).toEqual({
      queue: 440,
      range: 'season:3'
    })
    expect(validateRankSearch({ queue: 'flex', range: '7d' })).toEqual({ queue: 'flex', range: '7d' })
    expect(validateLpEditorSearch({ queue: 'solo', match: 'KR_9' })).toEqual({ queue: 'solo', match: 'KR_9' })
  })

  it('leaves out what it cannot read, rather than keeping it as undefined', () => {
    const search = validateDashboardSearch({ queue: 'ranked', match: '' })
    expect(search).toEqual({})
    expect('queue' in search).toBe(false)
    expect(validateRankSearch({ queue: 'RANKED_FLEX_SR', range: '90d' })).toEqual({})
  })

  it('keeps a match id as text when it happened to look like a number', () => {
    expect(validateDashboardSearch({ match: 5312345678 })).toEqual({ match: '5312345678' })
  })
})

describe('search and screen props', () => {
  it('opens on Ranked Solo/Duo, and says nothing in the URL while it does', () => {
    expect(queueIdFrom(undefined)).toBe(420)
    expect(queueSearchFor(420)).toBeUndefined()
  })

  it('writes "every queue" as `all`, never as null', () => {
    expect(queueSearchFor(null)).toBe('all')
    expect(queueIdFrom('all')).toBeNull()
    expect(queueIdFrom(queueSearchFor(450))).toBe(450)
  })

  it('names the ladders and the rank period the same way', () => {
    expect(queueTypeFrom(undefined)).toBe('RANKED_SOLO_5x5')
    expect(queueTypeFrom('flex')).toBe('RANKED_FLEX_SR')
    expect(rankQueueSearchFor('RANKED_SOLO_5x5')).toBeUndefined()
    expect(rankQueueSearchFor('RANKED_FLEX_SR')).toBe('flex')
    expect(rankRangeSearchFor('30d')).toBeUndefined()
    expect(rankRangeSearchFor('season:12')).toBe('season:12')
  })
})

describe('rememberSearch', () => {
  // What a link to the page asks for, before the memory has had its say.
  const linkTo = (memory: ReturnType<typeof rememberSearch<DashboardSearch>>, asked: DashboardSearch) =>
    memory.middleware({ search: {}, next: () => asked })

  it('fills in a filter a link left out with the one the page last showed', () => {
    const memory = rememberSearch<DashboardSearch>(['queue'])
    memory.record({ queue: 450 })
    expect(linkTo(memory, {})).toEqual({ queue: 450 })
  })

  it('leaves a filter the link chose alone', () => {
    const memory = rememberSearch<DashboardSearch>(['queue'])
    memory.record({ queue: 450 })
    expect(linkTo(memory, { queue: 'all' })).toEqual({ queue: 'all' })
  })

  it('treats a filter set to undefined as a choice — back to the default — and does not fill it', () => {
    const memory = rememberSearch<DashboardSearch>(['queue'])
    memory.record({ queue: 450 })
    expect(linkTo(memory, { queue: undefined }).queue).toBeUndefined()
  })

  it('forgets a filter once the page is back on its default', () => {
    const memory = rememberSearch<DashboardSearch>(['queue'])
    memory.record({ queue: 450 })
    memory.record({})
    expect(linkTo(memory, {})).toEqual({})
  })

  it('remembers only the keys it was given', () => {
    const memory = rememberSearch<DashboardSearch>(['queue'])
    memory.record({ queue: 450, match: 'NA1_1' })
    expect(linkTo(memory, {})).toEqual({ queue: 450 })
  })
})

describe('search serialisation', () => {
  it('writes values as plain text rather than JSON', () => {
    expect(stringifySearch({ queue: 'all', range: 'season:12' })).toBe('?queue=all&range=season%3A12')
    expect(stringifySearch({ q: 'Faker#KR1' })).toBe('?q=Faker%23KR1')
    expect(stringifySearch({ queue: undefined })).toBe('')
  })

  it('reads them back as it wrote them', () => {
    expect(parseSearch('?queue=all&range=season%3A12')).toEqual({ queue: 'all', range: 'season:12' })
    expect(parseSearch(stringifySearch({ queue: 450 }))).toEqual({ queue: 450 })
    expect(parseSearch('?q=Faker%23KR1')).toEqual({ q: 'Faker#KR1' })
  })

  it('does not unwrap text that happens to look like JSON', () => {
    expect(parseSearch('?q=%22Faker%22')).toEqual({ q: '"Faker"' })
  })
})

describe('links core writes, as the routes read them', () => {
  // The desktop's "Copy link" builds these with core's paths, and the web
  // client's routes read them. If the two drifted, a shared link would open on
  // the wrong view — or on the default one, silently.
  it('agrees on the history view', () => {
    expect(validateDashboardSearch(searchOf(paths.player(FAKER, { queue: null, match: 'KR_7' })))).toEqual({
      queue: 'all',
      match: 'KR_7'
    })
  })

  it('agrees on the champion table', () => {
    expect(validateChampionsSearch(searchOf(paths.champions(FAKER, { queue: 440, range: 'season:12' })))).toEqual({
      queue: 440,
      range: 'season:12'
    })
  })

  it('agrees on the rank graph and the LP editor', () => {
    expect(validateRankSearch(searchOf(paths.rank(FAKER, { queue: 'flex', range: 'all' })))).toEqual({
      queue: 'flex',
      range: 'all'
    })
    expect(validateLpEditorSearch(searchOf(paths.lpEditor(FAKER, { queue: 'solo', match: 'KR_7' })))).toEqual({
      queue: 'solo',
      match: 'KR_7'
    })
  })

  it('agrees on whose game a match link is about', () => {
    expect(validateMatchSearch(searchOf(paths.match('KR_7', { player: FAKER })))).toEqual({
      player: 'Faker-KR1'
    })
  })

  it('agrees on the TFT history, its rank page and a TFT recording', () => {
    expect(validateTftSearch(searchOf(paths.tft(FAKER, { queue: 1160, match: 'KR_8' })))).toEqual({
      queue: 1160,
      match: 'KR_8'
    })
    expect(validateTftRankSearch(searchOf(paths.tftRank(FAKER, { queue: 'hyper-roll', range: '7d' })))).toEqual({
      queue: 'hyper-roll',
      range: '7d'
    })
    expect(validateRecordingSearch(searchOf(paths.recording(FAKER, 'KR_8', { game: 'tft' })))).toEqual({
      game: 'tft'
    })
  })
})

describe('TFT search', () => {
  it('opens the history on every queue, and says nothing in the URL while it does', () => {
    expect(tftQueueIdFrom(undefined)).toBeNull()
    expect(tftQueueSearchFor(null)).toBeUndefined()
    expect(tftQueueIdFrom(tftQueueSearchFor(1100))).toBe(1100)
  })

  it('opens the rank page on Ranked, and says nothing in the URL while it does', () => {
    expect(tftLadderFrom(undefined)).toBe('RANKED_TFT')
    expect(tftRankQueueSearchFor('RANKED_TFT')).toBeUndefined()
    expect(tftLadderFrom(tftRankQueueSearchFor('RANKED_TFT_DOUBLE_UP'))).toBe('RANKED_TFT_DOUBLE_UP')
  })

  it('reads the other game’s ladder as absent rather than as a ladder', () => {
    // A League page asked for a TFT ladder opens on its own default, and the
    // other way round, rather than asking for a history it does not draw.
    expect(validateRankSearch({ queue: 'tft' })).toEqual({})
    expect(validateTftRankSearch({ queue: 'solo' })).toEqual({})
    expect(tftLadderFrom('flex')).toBe('RANKED_TFT')
  })

  it('keeps Hyper Roll out of the LP editor, which has no LP to type for it', () => {
    expect(validateLpEditorSearch({ queue: 'double-up' })).toEqual({ queue: 'double-up' })
    expect(validateLpEditorSearch({ queue: 'hyper-roll' })).toEqual({})
  })

  it('says only a TFT recording’s game, since League is what a recording is otherwise', () => {
    expect(paths.recording(FAKER, 'KR_8')).toBe('/players/Faker-KR1/recordings/KR_8')
    expect(paths.recording(FAKER, 'KR_8', { game: 'lol' })).toBe('/players/Faker-KR1/recordings/KR_8')
    expect(validateRecordingSearch({ game: 'chess' })).toEqual({})
  })
})
