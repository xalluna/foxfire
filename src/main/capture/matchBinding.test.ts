import { describe, expect, it } from 'vitest'
import {
  BIND_GIVE_UP_MS,
  findMatchForRecording,
  shouldGiveUpBinding,
  type MatchCandidate,
  type RecordingFingerprint
} from './matchBinding'

const T0 = 1_700_000_000_000
const HALF_HOUR = 30 * 60 * 1000

/** Ten champions, ours first. */
const ROSTER = [112, 64, 51, 412, 875, 238, 22, 89, 245, 105]

function recording(over: Partial<RecordingFingerprint> = {}): RecordingFingerprint {
  return {
    startedAt: T0,
    endedAt: T0 + HALF_HOUR,
    roster: [...ROSTER],
    selfChampionId: 112,
    ...over
  }
}

function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    matchId: 'NA1_1',
    gameCreation: T0 - 120_000,
    gameDuration: 1800,
    // Riot returns participants in its own order, never the scoreboard's.
    championIds: [875, 22, 112, 245, 51, 105, 64, 89, 412, 238],
    selfChampionId: 112,
    taken: false,
    ...over
  }
}

describe('findMatchForRecording', () => {
  it('binds a game whose roster lines up, whatever order Riot lists it in', () => {
    const result = findMatchForRecording(recording(), [candidate()])

    expect(result?.matchId).toBe('NA1_1')
    expect(result?.confidence).toBe(1)
  })

  it('picks the right one of two games that finished minutes apart', () => {
    const other = candidate({
      matchId: 'NA1_2',
      gameCreation: T0 + 60_000,
      championIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      selfChampionId: 1
    })

    expect(findMatchForRecording(recording(), [other, candidate()])?.matchId).toBe('NA1_1')
  })

  it('refuses a game where you played somebody else', () => {
    const wrongChampion = candidate({ selfChampionId: 64 })

    expect(findMatchForRecording(recording(), [wrongChampion])).toBeNull()
  })

  it('tolerates a champion the asset manifest has not caught up with', () => {
    // One id came back unresolved from the live scoreboard.
    const withHole = recording({ roster: [...ROSTER.slice(0, 9), -1] })

    expect(findMatchForRecording(withHole, [candidate()])?.matchId).toBe('NA1_1')
  })

  it('refuses a roster that only half agrees', () => {
    const halfWrong = recording({ roster: [...ROSTER.slice(0, 5), 1, 2, 3, 4, 5] })

    expect(findMatchForRecording(halfWrong, [candidate()])).toBeNull()
  })

  it('leaves yesterday’s game on the same champions alone', () => {
    const yesterday = candidate({ gameCreation: T0 - 24 * 60 * 60 * 1000 })

    expect(findMatchForRecording(recording(), [yesterday])).toBeNull()
  })

  it('will not claim a match another recording already owns', () => {
    expect(findMatchForRecording(recording(), [candidate({ taken: true })])).toBeNull()
  })

  it('prefers the better roster agreement over the closer clock', () => {
    const closerButWorse = candidate({
      matchId: 'NA1_close',
      gameCreation: T0 + HALF_HOUR - 1800_000,
      championIds: [...ROSTER.slice(0, 8), 999, 998]
    })

    const result = findMatchForRecording(recording(), [closerButWorse, candidate()])
    expect(result?.matchId).toBe('NA1_1')
  })

  it('returns nothing when there is nothing to bind to, which is the Practice Tool case', () => {
    expect(findMatchForRecording(recording(), [])).toBeNull()
  })

  it('gives up on a recording with no roster at all', () => {
    expect(findMatchForRecording(recording({ roster: [] }), [candidate()])).toBeNull()
  })

  it('still binds when the champion you played is unknown on one side', () => {
    const noSelf = candidate({ selfChampionId: null })

    expect(findMatchForRecording(recording(), [noSelf])?.matchId).toBe('NA1_1')
  })

  it('counts a champion picked on both teams only as often as it appears', () => {
    // Mirror matches are legal in customs and blind pick.
    const mirrored = recording({ roster: [112, 112, 51, 412, 875, 238, 22, 89, 245, 105] })
    const onlyOne = candidate({
      championIds: [112, 64, 51, 412, 875, 238, 22, 89, 245, 105]
    })

    // Nine of ten still clears the bar, but the duplicate must not be counted twice.
    expect(findMatchForRecording(mirrored, [onlyOne])?.confidence).toBeCloseTo(0.9)
  })
})

describe('shouldGiveUpBinding', () => {
  it('keeps waiting through the whole post-game retry schedule', () => {
    // postGameSync's last retry is at ten minutes.
    expect(shouldGiveUpBinding(recording(), T0 + HALF_HOUR + 11 * 60 * 1000)).toBe(false)
  })

  it('concludes rather than retrying forever', () => {
    expect(shouldGiveUpBinding(recording(), T0 + HALF_HOUR + BIND_GIVE_UP_MS + 1)).toBe(true)
  })

  it('measures from the end of a recording that never finished, not from now', () => {
    const crashed = recording({ endedAt: null })

    expect(shouldGiveUpBinding(crashed, T0 + 1000)).toBe(false)
    expect(shouldGiveUpBinding(crashed, T0 + BIND_GIVE_UP_MS + 1)).toBe(true)
  })
})
