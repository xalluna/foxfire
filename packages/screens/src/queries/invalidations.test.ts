import { describe, expect, it } from 'vitest'
import type { SyncProgressEvent } from '@foxfire/core'
import { invalidationsFor } from './invalidations'
import { queryKeys } from './keys'

const progress = (phase: SyncProgressEvent['phase']): SyncProgressEvent => ({
  accountId: 'acc-1',
  phase,
  current: 10,
  total: 10,
  trigger: 'auto'
})

describe('invalidationsFor', () => {
  it('refreshes nothing while a sync is still running', () => {
    expect(invalidationsFor({ kind: 'syncProgress', event: progress('backfill') })).toEqual([])
    expect(invalidationsFor({ kind: 'syncProgress', event: progress('error') })).toEqual([])
  })

  it('refreshes everything a finished sync touched, for that account only', () => {
    const keys = invalidationsFor({ kind: 'syncProgress', event: progress('complete') })

    expect(keys).toEqual([
      queryKeys.matchList('acc-1'),
      queryKeys.dashboard('acc-1'),
      queryKeys.rankHistory('acc-1'),
      queryKeys.championStats('acc-1'),
      queryKeys.rankPeriods('acc-1')
    ])
    // Scoped: the bare prefix would refetch every account's cached list.
    expect(keys).not.toContainEqual(queryKeys.matchLists())
  })

  it('refreshes the chip and the graph when LP is typed, on that account', () => {
    expect(invalidationsFor({ kind: 'rankEdited', accountId: 'acc-2' })).toEqual([
      queryKeys.rankHistory('acc-2'),
      queryKeys.matchList('acc-2'),
      queryKeys.dashboard('acc-2')
    ])
  })

  it('refreshes every account when the League client reports a rank', () => {
    expect(invalidationsFor({ kind: 'rankChanged', accountId: 'acc-3' })).toEqual([
      queryKeys.rankHistory(),
      queryKeys.matchLists(),
      queryKeys.dashboard()
    ])
  })

  it('refreshes everything derived from the season dates when they change', () => {
    expect(invalidationsFor({ kind: 'seasonsSaved' })).toEqual([
      queryKeys.rankPeriods(),
      queryKeys.rankHistory(),
      queryKeys.championStats(),
      queryKeys.matchLists()
    ])
  })
})

describe('a recording changing', () => {
  it('refreshes that account’s history and the recording under it, and nobody else’s', () => {
    const keys = invalidationsFor({ kind: 'recordingChanged', accountId: 'acc-1', matchId: 'NA1_1' })
    expect(keys).toEqual([queryKeys.matchList('acc-1')])

    const recording = queryKeys.matchRecording('acc-1', 'NA1_1')
    expect(recording.slice(0, keys[0]!.length)).toEqual(keys[0])

    const somebodyElse = queryKeys.matchRecording('acc-2', 'NA1_1')
    expect(somebodyElse.slice(0, keys[0]!.length)).not.toEqual(keys[0])
  })
})

describe('queryKeys', () => {
  it('nests, so a shorter key refreshes everything beneath it', () => {
    const full = queryKeys.matchList('acc-1', 420)
    const account = queryKeys.matchList('acc-1')
    const all = queryKeys.matchLists()

    expect(full.slice(0, account.length)).toEqual(account)
    expect(account.slice(0, all.length)).toEqual(all)
  })

  it('keeps the admin settings under one key, whichever page reads them', () => {
    // They were cached under two keys by the two pages that showed them, so
    // saving on one left the other stale.
    expect(queryKeys.admin.settings()).toEqual(['admin', 'settings'])
  })
})
