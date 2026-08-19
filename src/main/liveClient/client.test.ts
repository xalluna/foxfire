import { describe, expect, it } from 'vitest'
import { LiveClientError, isNotRunning } from './client'

/** A socket error as node:https reports it. */
function socketError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('isNotRunning', () => {
  it('forgives a 404, which is every game from champion select to the loading screen', () => {
    // The port is up and serving, it just has no game to describe yet. This
    // lasts minutes and used to put an error on screen every time.
    expect(isNotRunning(new LiveClientError('responded 404', 404))).toBe(true)
  })

  it('forgives a port with nothing behind it', () => {
    expect(isNotRunning(socketError('ECONNREFUSED'))).toBe(true)
    expect(isNotRunning(socketError('ECONNRESET'))).toBe(true)
    expect(isNotRunning(socketError('EHOSTUNREACH'))).toBe(true)
  })

  it('forgives the stall while the game loads in and out', () => {
    expect(isNotRunning(new LiveClientError('timed out', 0))).toBe(true)
  })

  it('lets a real fault through rather than reading it as an empty board', () => {
    expect(isNotRunning(new LiveClientError('responded 500', 500))).toBe(false)
    expect(isNotRunning(new LiveClientError('malformed JSON', 200))).toBe(false)
    expect(isNotRunning(socketError('ECONNABORTED'))).toBe(false)
    expect(isNotRunning(new Error('something else entirely'))).toBe(false)
    expect(isNotRunning(null)).toBe(false)
  })
})
