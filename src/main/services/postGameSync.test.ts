import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RiotApiError } from '../riot/rateLimiter'

// The logger opens a file under app.getPath, so it needs Electron. Nothing here
// asserts on log output.
vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, error: () => {} })
}))

const syncAccount = vi.fn()
vi.mock('./syncService', () => ({ syncAccount: (...args: unknown[]) => syncAccount(...args) }))

const { cancelAllPostGameSyncs, schedulePostGameSync } = await import('./postGameSync')

const ACCOUNT = 1

/** Nothing new on this attempt — Riot has not published the match yet. */
const EMPTY = { stored: 0, failed: 0 }
const FOUND = { stored: 1, failed: 0 }

/** Long enough to carry past every delay in the schedule. */
const PAST_EVERYTHING = 30 * 60_000

describe('schedulePostGameSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncAccount.mockReset()
  })

  afterEach(() => {
    cancelAllPostGameSyncs()
    vi.useRealTimers()
  })

  it('does not sync immediately — Riot has not published the match yet', async () => {
    syncAccount.mockResolvedValue(FOUND)
    schedulePostGameSync(ACCOUNT)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(syncAccount).not.toHaveBeenCalled()
  })

  it('stops as soon as an attempt stores a match', async () => {
    syncAccount.mockResolvedValue(FOUND)
    schedulePostGameSync(ACCOUNT)

    await vi.advanceTimersByTimeAsync(PAST_EVERYTHING)
    expect(syncAccount).toHaveBeenCalledTimes(1)
    expect(syncAccount).toHaveBeenCalledWith(ACCOUNT, 'auto')
  })

  it('keeps retrying while the match is still missing, then stops when it lands', async () => {
    syncAccount.mockResolvedValueOnce(EMPTY).mockResolvedValueOnce(EMPTY).mockResolvedValue(FOUND)

    schedulePostGameSync(ACCOUNT)
    await vi.advanceTimersByTimeAsync(PAST_EVERYTHING)

    expect(syncAccount).toHaveBeenCalledTimes(3)
  })

  it('gives up rather than retrying forever', async () => {
    syncAccount.mockResolvedValue(EMPTY)

    schedulePostGameSync(ACCOUNT)
    await vi.advanceTimersByTimeAsync(PAST_EVERYTHING)

    const attempts = syncAccount.mock.calls.length
    expect(attempts).toBeGreaterThan(1)

    // Nothing further once the schedule is exhausted.
    await vi.advanceTimersByTimeAsync(PAST_EVERYTHING)
    expect(syncAccount).toHaveBeenCalledTimes(attempts)
  })

  it('retries after an ordinary failure', async () => {
    syncAccount.mockRejectedValueOnce(new Error('network down')).mockResolvedValue(FOUND)

    schedulePostGameSync(ACCOUNT)
    await vi.advanceTimersByTimeAsync(PAST_EVERYTHING)

    expect(syncAccount).toHaveBeenCalledTimes(2)
  })

  it('abandons the schedule when Riot rejects the API key', async () => {
    // The limiter latches paused on 401/403, so every remaining attempt would
    // fail the same way until a new key is saved.
    syncAccount.mockRejectedValue(new RiotApiError('unauthorized', 401))

    schedulePostGameSync(ACCOUNT)
    await vi.advanceTimersByTimeAsync(PAST_EVERYTHING)

    expect(syncAccount).toHaveBeenCalledTimes(1)
  })

  it('replaces a pending schedule rather than running two at once', async () => {
    syncAccount.mockResolvedValue(EMPTY)

    // Back-to-back games: the second ending arrives before the first schedule
    // has run out. A delta sync fetches everything new, so the later schedule
    // covers both games.
    schedulePostGameSync(ACCOUNT)
    await vi.advanceTimersByTimeAsync(45_000)
    const afterFirst = syncAccount.mock.calls.length

    schedulePostGameSync(ACCOUNT)
    await vi.advanceTimersByTimeAsync(45_000)

    expect(syncAccount.mock.calls.length).toBe(afterFirst + 1)
  })

  it('stops everything when the app quits mid-schedule', async () => {
    syncAccount.mockResolvedValue(EMPTY)

    schedulePostGameSync(ACCOUNT)
    cancelAllPostGameSyncs()

    await vi.advanceTimersByTimeAsync(PAST_EVERYTHING)
    expect(syncAccount).not.toHaveBeenCalled()
  })

})
