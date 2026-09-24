import { describe, expect, it } from 'vitest'
import type { SyncProgressEvent, SyncState } from '@foxfire/core'
import { syncCooldownUntil } from './syncProgress'

const EARLIER = '2026-09-24T20:00:00.0000000+00:00'
const LATER = '2026-09-24T20:05:00Z'

const state = (cooldownUntil: string | null): SyncState => ({
  accountId: 'acc-1',
  mostRecentMatchId: null,
  backfillComplete: true,
  backfillTarget: 200,
  lastFullSyncAt: null,
  lastDeltaSyncAt: null,
  cooldownUntil
})

const progress = (
  phase: SyncProgressEvent['phase'],
  cooldownUntil?: string | null
): SyncProgressEvent => ({
  accountId: 'acc-1',
  phase,
  current: 10,
  total: 10,
  trigger: 'manual',
  cooldownUntil
})

describe('syncCooldownUntil', () => {
  it('is null when nothing holds the button back', () => {
    expect(syncCooldownUntil(undefined, undefined)).toBeNull()
    expect(syncCooldownUntil(null, undefined)).toBeNull()
    // This PC alone: no cooldown, and its own events never carry one.
    expect(syncCooldownUntil(state(null), progress('complete'))).toBeNull()
  })

  it('takes the profile’s answer before any sync has finished here', () => {
    expect(syncCooldownUntil(state(EARLIER), undefined)).toBe(EARLIER)
  })

  it('takes a finished sync’s answer before the refetch it set off has landed', () => {
    expect(syncCooldownUntil(state(null), progress('complete', LATER))).toBe(LATER)
    expect(syncCooldownUntil(state(EARLIER), progress('complete', LATER))).toBe(LATER)
  })

  it('keeps the later one, whichever arrived first', () => {
    // A sync finished in another window, after this event, and the refetched
    // profile already knows.
    expect(syncCooldownUntil(state(LATER), progress('complete', EARLIER))).toBe(LATER)
  })

  it('reads the time only off a finished sync', () => {
    expect(syncCooldownUntil(state(EARLIER), progress('delta', LATER))).toBe(EARLIER)
    expect(syncCooldownUntil(state(EARLIER), progress('error', LATER))).toBe(EARLIER)
  })
})
