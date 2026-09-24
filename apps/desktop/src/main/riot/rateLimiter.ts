import { EventEmitter } from 'events'

export interface RateLimiterConfig {
  /** Max requests per `burstWindowMs` (Riot personal key default: 20/1s). */
  burstLimit: number
  burstWindowMs: number
  /** Max requests per `sustainedWindowMs` (Riot personal key default: 100/2min). */
  sustainedLimit: number
  sustainedWindowMs: number
  /** Base delay for 5xx retry backoff, multiplied by attempt number. */
  retryBackoffMs: number
}

export const PERSONAL_KEY_LIMITS: RateLimiterConfig = {
  burstLimit: 20,
  burstWindowMs: 1_000,
  sustainedLimit: 100,
  sustainedWindowMs: 120_000,
  retryBackoffMs: 1_000
}

/**
 * Riot's standard limits for an approved application key — two orders of
 * magnitude above a personal one, which is what turns a 200-match backfill from
 * minutes into seconds.
 *
 * A default rather than a truth: limits are granted per product, and an
 * approved key can carry different ones. The settings screen lets the numbers
 * be edited for that reason, and this is what it starts from.
 */
export const APPLICATION_KEY_LIMITS: RateLimiterConfig = {
  burstLimit: 500,
  burstWindowMs: 10_000,
  sustainedLimit: 30_000,
  sustainedWindowMs: 600_000,
  retryBackoffMs: 1_000
}

interface QueuedJob<T> {
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
  attempts: number
}

export class RiotApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
    /**
     * Riot could not decrypt a puuid we sent, because it was encrypted under a
     * previous API key. Distinguished from every other 400 because it is the
     * one that the app can repair by itself — see services/identityService.ts.
     */
    public readonly staleIdentity = false
  ) {
    super(message)
    this.name = 'RiotApiError'
  }
}

const MAX_RETRIES = 3

/**
 * Single app-wide queue wrapping every Riot API call. Riot's rate limit is
 * per API key (global to the process), so backfill, delta sync and ad-hoc
 * search all share this one fair FIFO queue rather than each racing to send
 * requests independently.
 *
 * Requests are dispatched one at a time, paced by the burst window, rather
 * than truly concurrently — simpler to reason about and Riot's typical
 * latency (<500ms) means this doesn't meaningfully hurt throughput.
 */
export class RiotRateLimiter extends EventEmitter {
  private config: RateLimiterConfig
  private queue: QueuedJob<unknown>[] = []
  private dispatchTimestamps: number[] = []
  private pumping = false
  private pausedUntil: number | null = null
  private paused = false
  /**
   * Set when the key is rejected (401/403). Personal keys expire every 24h, so
   * this happens routinely — often mid-backfill. Queued work is failed fast
   * rather than left hanging, and new work is rejected until a fresh key
   * arrives, so callers surface an error instead of stalling forever.
   */
  private fatalError: RiotApiError | null = null

  constructor(config: RateLimiterConfig = PERSONAL_KEY_LIMITS) {
    super()
    this.config = config
  }

  updateConfig(config: RateLimiterConfig): void {
    this.config = config
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    this.pausedUntil = null
    this.fatalError = null
    this.pump()
  }

  /** Fails every queued job with the same error, so nothing waits on a queue that will never drain. */
  private drainQueue(err: RiotApiError): void {
    const pending = this.queue.splice(0, this.queue.length)
    for (const job of pending) job.reject(err)
  }

  get queueDepth(): number {
    return this.queue.length
  }

  /**
   * Whether Riot has rejected the current key, as a latched value.
   *
   * The 'key-invalid' event alone is not enough: it fires the instant a request
   * comes back 401, which at startup is before the renderer has mounted and
   * subscribed, so the notification lands on nobody and the user is left with
   * an app that quietly fetches nothing. Reading the state instead lets the
   * window find out at any point after the fact.
   */
  get keyRejected(): boolean {
    return this.fatalError !== null
  }

  schedule<T>(run: () => Promise<T>): Promise<T> {
    if (this.fatalError) return Promise.reject(this.fatalError)
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve, reject, attempts: 0 } as QueuedJob<unknown>)
      this.pump()
    })
  }

  private msUntilBurstSlot(now: number): number {
    this.pruneTimestamps(now)
    if (this.dispatchTimestamps.length < this.config.burstLimit) return 0
    const oldest = this.dispatchTimestamps[0]
    return Math.max(0, oldest + this.config.burstWindowMs - now)
  }

  private msUntilSustainedSlot(now: number): number {
    this.pruneTimestamps(now)
    const recentInWindow = this.dispatchTimestamps.filter(
      (t) => now - t < this.config.sustainedWindowMs
    )
    if (recentInWindow.length < this.config.sustainedLimit) return 0
    const oldest = recentInWindow[0]
    return Math.max(0, oldest + this.config.sustainedWindowMs - now)
  }

  private pruneTimestamps(now: number): void {
    const cutoff = now - this.config.sustainedWindowMs
    while (this.dispatchTimestamps.length && this.dispatchTimestamps[0] < cutoff) {
      this.dispatchTimestamps.shift()
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length > 0) {
        if (this.paused) return

        const now = Date.now()
        if (this.pausedUntil && now < this.pausedUntil) {
          await sleep(this.pausedUntil - now)
          continue
        }

        const waitMs = Math.max(this.msUntilBurstSlot(Date.now()), this.msUntilSustainedSlot(Date.now()))
        if (waitMs > 0) {
          await sleep(waitMs)
          continue
        }

        const job = this.queue.shift()!
        this.dispatchTimestamps.push(Date.now())
        this.emit('dispatch', { queueDepth: this.queue.length })

        try {
          const result = await job.run()
          job.resolve(result)
        } catch (err) {
          await this.handleJobError(job, err)
        }
      }
    } finally {
      this.pumping = false
    }
  }

  private async handleJobError(job: QueuedJob<unknown>, err: unknown): Promise<void> {
    if (err instanceof RiotApiError && err.status === 429) {
      job.attempts += 1
      if (job.attempts <= MAX_RETRIES) {
        this.pausedUntil = Date.now() + (err.retryAfterMs ?? 2_000)
        this.queue.unshift(job)
        return
      }
      job.reject(err)
      return
    }

    if (err instanceof RiotApiError && (err.status === 401 || err.status === 403)) {
      this.paused = true
      this.fatalError = err
      this.emit('key-invalid', err)
      job.reject(err)
      this.drainQueue(err)
      return
    }

    if (err instanceof RiotApiError && err.status >= 500) {
      job.attempts += 1
      if (job.attempts <= MAX_RETRIES) {
        this.pausedUntil = Date.now() + this.config.retryBackoffMs * job.attempts
        this.queue.unshift(job)
        return
      }
    }

    job.reject(err)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
