import { describe, expect, it } from 'vitest'
import { copyFileName, gameIdFromMatchId, matchIdFromRoflName } from './filename'

describe('matchIdFromRoflName', () => {
  it('turns Riot\u2019s name into a match id', () => {
    expect(matchIdFromRoflName('NA1-5312345678.rofl')).toBe('NA1_5312345678')
  })

  it('handles platforms with and without a trailing digit', () => {
    expect(matchIdFromRoflName('EUW1-7412345678.rofl')).toBe('EUW1_7412345678')
    expect(matchIdFromRoflName('KR-6812345678.rofl')).toBe('KR_6812345678')
  })

  it('normalises case, because the filesystem does not', () => {
    expect(matchIdFromRoflName('na1-5312345678.rofl')).toBe('NA1_5312345678')
  })

  it('does not need the extension', () => {
    expect(matchIdFromRoflName('NA1-5312345678')).toBe('NA1_5312345678')
  })

  it('refuses a renamed file rather than guessing', () => {
    expect(matchIdFromRoflName('my best pentakill.rofl')).toBeNull()
    expect(matchIdFromRoflName('NA1_5312345678.rofl')).toBeNull()
    expect(matchIdFromRoflName('NA1-.rofl')).toBeNull()
    expect(matchIdFromRoflName('-5312345678.rofl')).toBeNull()
  })

  it('refuses a game id too short to be one', () => {
    expect(matchIdFromRoflName('NA1-12.rofl')).toBeNull()
  })
})

describe('copyFileName', () => {
  it('keeps Riot\u2019s name when the match is known', () => {
    expect(copyFileName('NA1_5312345678', 'whatever.rofl')).toBe('NA1-5312345678.rofl')
  })

  it('falls back to a filesystem-safe stem', () => {
    expect(copyFileName(null, 'my best: pentakill!.rofl')).toBe('my_best_pentakill.rofl')
  })

  it('never returns a bare extension', () => {
    expect(copyFileName(null, '***.rofl')).toBe('replay.rofl')
  })
})

describe('gameIdFromMatchId', () => {
  it('pulls the id the League client keys its replay routes on', () => {
    expect(gameIdFromMatchId('NA1_5624743500')).toBe('5624743500')
    expect(gameIdFromMatchId('EUW1_7412345678')).toBe('7412345678')
  })

  it('is null when there is no match to take it from', () => {
    expect(gameIdFromMatchId(null)).toBeNull()
  })

  it('refuses anything that is not a match id', () => {
    expect(gameIdFromMatchId('NA1-5624743500')).toBeNull()
    expect(gameIdFromMatchId('not a match id')).toBeNull()
  })
})
