import { describe, expect, it } from 'vitest'
import { isGameEndTransition, isPlayingPhase } from './gameflow'

describe('isPlayingPhase', () => {
  it('counts both InProgress and Reconnect as being in a game', () => {
    expect(isPlayingPhase('InProgress')).toBe(true)
    expect(isPlayingPhase('Reconnect')).toBe(true)
  })

  it('rejects lobby and champ-select phases', () => {
    for (const phase of ['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'GameStart']) {
      expect(isPlayingPhase(phase)).toBe(false)
    }
  })

  it('handles a phase that has not been read yet', () => {
    expect(isPlayingPhase(null)).toBe(false)
  })
})

describe('isGameEndTransition', () => {
  it('fires on each phase the client may land on after a game', () => {
    for (const end of ['WaitingForStats', 'PreEndOfGame', 'EndOfGame']) {
      expect(isGameEndTransition('InProgress', end)).toBe(true)
    }
  })

  it('fires when the game ended while the client was reconnecting', () => {
    expect(isGameEndTransition('Reconnect', 'EndOfGame')).toBe(true)
  })

  it('does not fire when a client drops mid-game', () => {
    // The naive "left InProgress" rule reads this as a finished game and syncs
    // in the middle of the match, then does it again on the way back.
    expect(isGameEndTransition('InProgress', 'Reconnect')).toBe(false)
    expect(isGameEndTransition('Reconnect', 'InProgress')).toBe(false)
  })

  it('fires once across a run of end phases', () => {
    // Only the first hop crosses out of a playing phase, so a client that walks
    // WaitingForStats -> PreEndOfGame -> EndOfGame schedules one sync, not three.
    expect(isGameEndTransition('InProgress', 'WaitingForStats')).toBe(true)
    expect(isGameEndTransition('WaitingForStats', 'PreEndOfGame')).toBe(false)
    expect(isGameEndTransition('PreEndOfGame', 'EndOfGame')).toBe(false)
  })

  it('does not fire on a game starting', () => {
    expect(isGameEndTransition('ChampSelect', 'GameStart')).toBe(false)
    expect(isGameEndTransition('GameStart', 'InProgress')).toBe(false)
  })

  it('does not fire when the client is closed mid-game', () => {
    // None carries no stats to fetch, and treating it as an ending would sync
    // every time the client quit.
    expect(isGameEndTransition('InProgress', 'None')).toBe(false)
  })

  it('does not fire on the first phase ever observed', () => {
    expect(isGameEndTransition(null, 'EndOfGame')).toBe(false)
  })

  it('does not fire when the phase is unchanged', () => {
    expect(isGameEndTransition('InProgress', 'InProgress')).toBe(false)
    expect(isGameEndTransition('EndOfGame', 'EndOfGame')).toBe(false)
  })
})
