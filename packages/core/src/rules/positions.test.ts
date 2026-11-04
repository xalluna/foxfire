import { describe, expect, it } from 'vitest'
import { inPositionOrder, positionIndex } from './positions'

const player = (name: string, teamPosition: string | null) => ({ name, teamPosition })

describe('positionIndex', () => {
  it('places the five lanes top to support, and anything else after them', () => {
    expect(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map(positionIndex)).toEqual([0, 1, 2, 3, 4])
    expect(positionIndex('')).toBe(5)
    expect(positionIndex(null)).toBe(5)
    expect(positionIndex('Invalid')).toBe(5)
  })
})

describe('inPositionOrder', () => {
  it('reads a team top, jungle, mid, bot, support', () => {
    const team = [
      player('sup', 'UTILITY'),
      player('mid', 'MIDDLE'),
      player('top', 'TOP'),
      player('bot', 'BOTTOM'),
      player('jg', 'JUNGLE')
    ]

    expect(inPositionOrder(team).map((p) => p.name)).toEqual(['top', 'jg', 'mid', 'bot', 'sup'])
  })

  it('keeps a lobby without lanes in the order it came in', () => {
    const team = ['a', 'b', 'c', 'd', 'e'].map((name) => player(name, ''))

    expect(inPositionOrder(team).map((p) => p.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('puts a player with no lane below the five', () => {
    const team = [
      player('none', null),
      player('bot', 'BOTTOM'),
      player('blank', ''),
      player('top', 'TOP')
    ]

    expect(inPositionOrder(team).map((p) => p.name)).toEqual(['top', 'bot', 'none', 'blank'])
  })

  it('leaves the list it was given alone', () => {
    const team = [player('sup', 'UTILITY'), player('top', 'TOP')]

    inPositionOrder(team)

    expect(team.map((p) => p.name)).toEqual(['sup', 'top'])
  })
})
