import { describe, expect, it } from 'vitest'
import { belongsHere, holdFor, mayDeleteAfterUpload, processingPollMs, type HoldFacts } from './rules'

const CLEAR: HoldFacts = {
  serverMode: true,
  recordings: true,
  activeServer: 'https://foxfire.example.com',
  gameOn: false,
  recording: false,
  serverFull: false,
  pausedByHand: false
}

describe('holdFor', () => {
  it('lets uploads run on a server with recordings, between games', () => {
    expect(holdFor(CLEAR)).toBeNull()
  })

  it('holds for a game, and for a recorder rolling, whatever else is true', () => {
    expect(holdFor({ ...CLEAR, gameOn: true })).toBe('game')
    expect(holdFor({ ...CLEAR, recording: true })).toBe('game')
    expect(holdFor({ ...CLEAR, gameOn: true, recordings: false })).toBe('game')
  })

  it('holds with no server to mint a token, or one with nowhere to put the file', () => {
    expect(holdFor({ ...CLEAR, serverMode: false, activeServer: null })).toBe('local_only')
    expect(holdFor({ ...CLEAR, recordings: false })).toBe('no_recordings')
    expect(holdFor({ ...CLEAR, serverFull: true })).toBe('server_full')
  })

  it('holds when somebody paused it, before anything else', () => {
    expect(holdFor({ ...CLEAR, pausedByHand: true, gameOn: true })).toBe('paused')
  })
})

describe('belongsHere', () => {
  it('runs an upload only on the server it was queued for', () => {
    expect(belongsHere('https://a.example.com', 'https://a.example.com')).toBe(true)
    expect(belongsHere('https://a.example.com', 'https://b.example.com')).toBe(false)
    expect(belongsHere('https://a.example.com', null)).toBe(false)
  })
})

describe('mayDeleteAfterUpload', () => {
  const same = { queuedBytes: 1_000, queuedMtime: 5, nowBytes: 1_000, nowMtime: 5 }

  it('deletes only when asked, once the server has it ready, and the file is the one sent', () => {
    expect(mayDeleteAfterUpload(true, 'ready', same)).toEqual({ delete: true })
  })

  it('keeps the file when nobody asked for it to go', () => {
    expect(mayDeleteAfterUpload(false, 'ready', same)).toEqual({ delete: false, reason: null })
  })

  it('keeps it until processing is done — and for good when processing failed', () => {
    expect(mayDeleteAfterUpload(true, 'processing', same).delete).toBe(false)
    expect(mayDeleteAfterUpload(true, 'failed', same).delete).toBe(false)
  })

  it('keeps a file that changed since it was queued', () => {
    expect(mayDeleteAfterUpload(true, 'ready', { ...same, nowBytes: 2_000 }).delete).toBe(false)
    expect(mayDeleteAfterUpload(true, 'ready', { ...same, nowMtime: 6 }).delete).toBe(false)
  })

  it('has nothing to do for a file already gone', () => {
    expect(mayDeleteAfterUpload(true, 'ready', { ...same, nowBytes: null, nowMtime: null })).toEqual({
      delete: false,
      reason: null
    })
  })
})

describe('processingPollMs', () => {
  it('asks every ten seconds at first, and no less often than every two minutes', () => {
    expect(processingPollMs(0)).toBe(10_000)
    expect(processingPollMs(1)).toBe(15_000)
    expect(processingPollMs(50)).toBe(120_000)
  })
})
