import { describe, expect, it } from 'vitest'
import type { CaptureStatus, LcuStatus } from '@shared/types'
import { APP_ICON_TOOLTIP, deriveAppIconState, type AppIconState } from './appIconState'

const IN_GAME: LcuStatus = {
  state: 'connected',
  accountId: '1',
  gameName: 'Ashe',
  tagLine: 'NA1',
  inGame: true
}
const CLIENT_IDLE: LcuStatus = { ...IN_GAME, inGame: false }
const CLIENT_GONE: LcuStatus = { state: 'disconnected' }
const UNTRACKED: LcuStatus = { state: 'untracked', gameName: 'Someone', tagLine: 'EUW' }

const RECORDING: CaptureStatus = { state: 'recording', recordingId: 7, startedAt: 0 }
const OBS_DOWN: CaptureStatus = { state: 'error', message: 'Not connected to OBS.' }
const CAPTURE_OFF: CaptureStatus = { state: 'off' }

describe('deriveAppIconState', () => {
  it('shows nothing with no client and no capture', () => {
    expect(deriveAppIconState(CLIENT_GONE, CAPTURE_OFF)).toBe('none')
  })

  it('shows a game being played with capture switched off', () => {
    expect(deriveAppIconState(IN_GAME, CAPTURE_OFF)).toBe('game')
  })

  it('shows a game that OBS cannot record', () => {
    expect(deriveAppIconState(IN_GAME, OBS_DOWN)).toBe('stalled')
  })

  it('shows a game being recorded', () => {
    expect(deriveAppIconState(IN_GAME, RECORDING)).toBe('recording')
  })

  it('treats every other capture state during a game as just a game', () => {
    // `connecting` belongs in this list on purpose: OBS still coming up is not
    // OBS having failed, and amber for the first seconds of every launch is
    // noise. `armed` is capture working exactly as intended, waiting for the
    // game to actually start.
    const states: CaptureStatus[] = [
      { state: 'off' },
      { state: 'connecting' },
      { state: 'idle' },
      { state: 'armed', queueId: 420 }
    ]
    for (const capture of states) {
      expect(deriveAppIconState(IN_GAME, capture)).toBe('game')
    }
  })
})

describe('deriveAppIconState precedence', () => {
  // The case this ordering exists for. A client that quits mid-game reports
  // `disconnected`, which carries no inGame field at all — so checking the game
  // first would drop the badge the instant League closed, while OBS was still
  // recording and captureService's 30-second GAME_LOST_MS backstop had yet to
  // fire.
  it('keeps the recording badge when the League client vanishes', () => {
    expect(deriveAppIconState(CLIENT_GONE, RECORDING)).toBe('recording')
  })

  // The watcher reports status once with the previous tick's inGame before
  // refreshing it, so on a 10-second poll a recording can briefly coincide with
  // inGame false. Reachable, not theoretical.
  it('keeps the recording badge when the client has not caught up', () => {
    expect(deriveAppIconState(CLIENT_IDLE, RECORDING)).toBe('recording')
  })

  it('keeps the recording badge on an untracked account', () => {
    expect(deriveAppIconState(UNTRACKED, RECORDING)).toBe('recording')
  })

  it('shows nothing for an untracked account otherwise', () => {
    // Somebody else is signed in. There is no game of ours to report on.
    expect(deriveAppIconState(UNTRACKED, CAPTURE_OFF)).toBe('none')
  })

  it('does not go amber when OBS is down and no game is on', () => {
    // Amber is a statement about a game in progress. OBS being shut while
    // nobody is playing is the settings screen's business, not the taskbar's.
    expect(deriveAppIconState(CLIENT_IDLE, OBS_DOWN)).toBe('none')
    expect(deriveAppIconState(CLIENT_GONE, OBS_DOWN)).toBe('none')
  })
})

describe('APP_ICON_TOOLTIP', () => {
  it('names every state', () => {
    const states: AppIconState[] = ['none', 'game', 'stalled', 'recording']
    for (const state of states) {
      expect(APP_ICON_TOOLTIP[state]).toMatch(/^Foxfire — /)
    }
  })
})
