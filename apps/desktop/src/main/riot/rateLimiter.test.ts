import { describe, expect, it } from 'vitest'
import { RiotApiError, RiotRateLimiter } from './rateLimiter'

const fastConfig = {
  burstLimit: 3,
  burstWindowMs: 100,
  sustainedLimit: 5,
  sustainedWindowMs: 400,
  retryBackoffMs: 20
}

describe('RiotRateLimiter', () => {
  it('paces against the config it was given last', async () => {
    // What the key-type setting is for: an application key is allowed to go
    // faster, and saying so has to actually change the pacing rather than only
    // the stored value.
    const limiter = new RiotRateLimiter(fastConfig)
    limiter.updateConfig({ ...fastConfig, burstLimit: 10, sustainedLimit: 10 })

    const start = Date.now()
    await Promise.all(Array.from({ length: 6 }, () => limiter.schedule(async () => Date.now())))

    // Six requests would have crossed both of fastConfig's limits and cost the
    // 400ms sustained window; under the raised one they are a single burst.
    expect(Date.now() - start).toBeLessThan(90)
  })

  it('runs jobs and returns their results in order', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    const results = await Promise.all([1, 2, 3].map((n) => limiter.schedule(async () => n)))
    expect(results).toEqual([1, 2, 3])
  })

  it('throttles once the burst limit is exceeded', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    const start = Date.now()
    await Promise.all(
      Array.from({ length: 4 }, () => limiter.schedule(async () => Date.now()))
    )
    // 4th request must wait for the 100ms burst window to roll over
    expect(Date.now() - start).toBeGreaterThanOrEqual(90)
  })

  it('throttles once the sustained limit is exceeded', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    const start = Date.now()
    await Promise.all(
      Array.from({ length: 6 }, () => limiter.schedule(async () => Date.now()))
    )
    // 6th request must wait for the 400ms sustained window
    expect(Date.now() - start).toBeGreaterThanOrEqual(390)
  })

  it('retries a 429 after its Retry-After delay', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    let attempts = 0
    const result = await limiter.schedule(async () => {
      attempts += 1
      if (attempts === 1) throw new RiotApiError('rate limited', 429, 50)
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(attempts).toBe(2)
  })

  it('retries 5xx errors then gives up after max retries', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    let attempts = 0
    await expect(
      limiter.schedule(async () => {
        attempts += 1
        throw new RiotApiError('server error', 503)
      })
    ).rejects.toThrow('server error')
    expect(attempts).toBe(4) // initial + 3 retries
  })

  it('pauses the queue and emits key-invalid on 401', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    let emitted = false
    limiter.on('key-invalid', () => {
      emitted = true
    })
    await expect(
      limiter.schedule(async () => {
        throw new RiotApiError('unauthorized', 401)
      })
    ).rejects.toThrow('unauthorized')
    expect(emitted).toBe(true)
  })

  it('fails queued jobs instead of hanging when the key expires mid-run', async () => {
    // A personal key expiring mid-backfill must not leave queued work stranded.
    const limiter = new RiotRateLimiter(fastConfig)
    const results = await Promise.allSettled([
      limiter.schedule(async () => {
        throw new RiotApiError('unauthorized', 401)
      }),
      limiter.schedule(async () => 'never runs'),
      limiter.schedule(async () => 'also never runs')
    ])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
  })

  it('rejects new work immediately while the key is known-bad', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    await expect(
      limiter.schedule(async () => {
        throw new RiotApiError('unauthorized', 401)
      })
    ).rejects.toThrow()

    let ran = false
    await expect(
      limiter.schedule(async () => {
        ran = true
        return 'x'
      })
    ).rejects.toThrow('unauthorized')
    expect(ran).toBe(false)
  })

  it('accepts work again after a fresh key resumes the queue', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    await expect(
      limiter.schedule(async () => {
        throw new RiotApiError('unauthorized', 401)
      })
    ).rejects.toThrow()

    limiter.resume()
    await expect(limiter.schedule(async () => 'ok')).resolves.toBe('ok')
  })

  it('does not retry a non-Riot error', async () => {
    const limiter = new RiotRateLimiter(fastConfig)
    let attempts = 0
    await expect(
      limiter.schedule(async () => {
        attempts += 1
        throw new Error('network down')
      })
    ).rejects.toThrow('network down')
    expect(attempts).toBe(1)
  })
})
