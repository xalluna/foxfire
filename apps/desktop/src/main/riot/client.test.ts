import { beforeEach, describe, expect, it, vi } from 'vitest'

// Both reach telemetry, and through it Electron. Neither is what this file is
// about: the question here is only what riotRequest makes of a response.
vi.mock('../telemetry/riotRecorder', () => ({
  beginRiotRequest: () => ({
    attemptStarted() {},
    attemptFailed() {},
    attemptSucceeded() {},
    abandoned() {},
    settle() {}
  })
}))
vi.mock('../telemetry/spans', () => ({
  captureContext: () => null,
  runInContext: <T>(_context: unknown, fn: () => T): T => fn()
}))

const {
  isNoProductAccess,
  isStaleIdentity,
  rateLimiter,
  riotRequest,
  setApiKey,
  setTftApiKey,
  tftKeyScope,
  tftRequest,
  tftScope
} = await import('./client')

const PASSTHROUGH = { parse: (data: unknown): unknown => data }

/** Riot's own wording when a puuid was encrypted under a key you no longer hold. */
const DECRYPT_BODY = JSON.stringify({
  status: { message: 'Exception decrypting puuid-from-the-old-key', status_code: 400 }
})

function answer(body: string, status: number): void {
  vi.stubGlobal('fetch', async () => new Response(body, { status }))
}

async function attempt(): Promise<unknown> {
  return riotRequest('/lol/match/v5/matches/by-puuid/{puuid}/ids', 'https://x', '/ids', PASSTHROUGH)
}

describe('riotRequest', () => {
  beforeEach(() => {
    setApiKey('RGAPI-test')
    // A 401 latches the limiter shut, which is the point of it — but it would
    // also fail every test after the one that provokes it.
    rateLimiter.resume()
  })

  it('marks a 400 Riot blames on decryption as a stale identity', async () => {
    answer(DECRYPT_BODY, 400)

    await expect(attempt()).rejects.toSatisfy(isStaleIdentity)
  })

  it('leaves every other 400 alone', async () => {
    answer('Bad Request - could not parse count', 400)

    await expect(attempt()).rejects.not.toSatisfy(isStaleIdentity)
  })

  it('does not confuse a rejected key for a stale identity', async () => {
    answer('Unauthorized', 401)

    await expect(attempt()).rejects.not.toSatisfy(isStaleIdentity)
  })

  it('returns the parsed body when Riot is happy', async () => {
    answer(JSON.stringify(['NA1_1']), 200)

    await expect(attempt()).resolves.toEqual(['NA1_1'])
  })
})

describe('tftRequest', () => {
  const tft = (): Promise<unknown> => tftRequest('/tft/status/v1/platform-data', 'https://x', '/status', PASSTHROUGH)

  beforeEach(() => {
    setApiKey('RGAPI-test')
    setTftApiKey(null)
    rateLimiter.resume()
    tftScope.limiter.resume()
  })

  it('reads a 403 on the main key as no TFT, and leaves League’s queue running', async () => {
    // A key registered for League alone gets a 403 from every TFT endpoint,
    // the status an expired key gets too. Latching on it would stop League
    // syncing over a game the key was never meant for.
    answer('Forbidden', 403)

    await expect(tft()).rejects.toSatisfy(isNoProductAccess)
    expect(rateLimiter.keyRejected).toBe(false)
    expect(tftKeyScope()).toBe('main')

    answer(JSON.stringify(['NA1_1']), 200)
    await expect(attempt()).resolves.toEqual(['NA1_1'])
  })

  it('still latches League’s queue on a 403 from League itself', async () => {
    answer('Forbidden', 403)

    await expect(attempt()).rejects.not.toSatisfy(isNoProductAccess)
    expect(rateLimiter.keyRejected).toBe(true)
  })

  it('asks through TFT’s own key when there is one, where a 403 is that key refused', async () => {
    setTftApiKey('RGAPI-tft')
    const sent: Array<string | null> = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get('X-Riot-Token'))
      return new Response('Forbidden', { status: 403 })
    })

    await expect(tft()).rejects.not.toSatisfy(isNoProductAccess)
    expect(sent).toEqual(['RGAPI-tft'])
    expect(tftKeyScope()).toBe('tft')
    expect(tftScope.limiter.keyRejected).toBe(true)
    // TFT's refused key is TFT's problem alone.
    expect(rateLimiter.keyRejected).toBe(false)
  })
})
