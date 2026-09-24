import { describe, expect, it } from 'vitest'
import { compareSearchResults, searchRank } from './search'

const p = (riotId: string) => {
  const [gameName, tagLine] = riotId.split('#')
  return { gameName, tagLine }
}

describe('searchRank', () => {
  it('puts an exact name or whole Riot ID first, in any capitalisation', () => {
    expect(searchRank(p('Ali#NA1'), 'ali')).toBe(0)
    expect(searchRank(p('Ali#NA1'), ' ALI#na1 ')).toBe(0)
  })

  it('puts a name that starts with the text next', () => {
    expect(searchRank(p('Alluna#NA1'), 'all')).toBe(1)
  })

  it('puts a name, tag or Riot ID that only contains it last', () => {
    expect(searchRank(p('Ball#NA1'), 'all')).toBe(2)
    expect(searchRank(p('Yoshi#ALL1'), 'all')).toBe(2)
    expect(searchRank(p('Alluna#NA1'), 'luna#na')).toBe(2)
  })

  it('is null for no match, and every player for a blank query', () => {
    expect(searchRank(p('Yoshi#3493'), 'all')).toBeNull()
    expect(searchRank(p('Yoshi#3493'), '  ')).toBe(2)
  })
})

describe('compareSearchResults', () => {
  it('orders closest first, then by name and tag', () => {
    const players = ['Snowfaker#EUW', 'Fakir#NA1', 'Faker#KR2', 'Faker#KR1', 'Afaker#NA1'].map(p)

    const ordered = players.sort(compareSearchResults('faker')).map((x) => `${x.gameName}#${x.tagLine}`)

    expect(ordered).toEqual(['Faker#KR1', 'Faker#KR2', 'Afaker#NA1', 'Snowfaker#EUW', 'Fakir#NA1'])
  })

  it('is name order for a blank query', () => {
    const players = ['yoshi#1', 'Alluna#NA1', 'alluna#5160'].map(p)

    expect(players.sort(compareSearchResults('')).map((x) => `${x.gameName}#${x.tagLine}`)).toEqual([
      'alluna#5160',
      'Alluna#NA1',
      'yoshi#1'
    ])
  })
})
