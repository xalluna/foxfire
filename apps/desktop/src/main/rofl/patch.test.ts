import { describe, expect, it } from 'vitest'
import { patchFromGameVersion, replayBlockedReason, runnerFor } from './patch'

const LIVE = 'C:\\Riot Games\\League of Legends'

describe('patchFromGameVersion', () => {
  it('keeps major.minor and discards the build', () => {
    expect(patchFromGameVersion('15.16.700.1234')).toBe('15.16')
    expect(patchFromGameVersion('16.16.804.9184')).toBe('16.16')
  })

  it('accepts the shorter shapes the same number arrives in', () => {
    expect(patchFromGameVersion('15.16')).toBe('15.16')
    expect(patchFromGameVersion('15.16.1')).toBe('15.16')
  })

  it('is null for anything it cannot read', () => {
    expect(patchFromGameVersion(null)).toBeNull()
    expect(patchFromGameVersion(undefined)).toBeNull()
    expect(patchFromGameVersion('')).toBeNull()
    expect(patchFromGameVersion('not a version')).toBeNull()
  })
})

describe('runnerFor', () => {
  it('prefers the live install, so today\u2019s replay needs no archive', () => {
    const runner = runnerFor('15.16', [{ patch: '15.16', path: 'D:\\old' }], '15.16', LIVE)
    expect(runner).toEqual({ patch: '15.16', path: LIVE, isLive: true })
  })

  it('falls back to an archive for an older patch', () => {
    const runner = runnerFor('15.14', [{ patch: '15.14', path: 'D:\\old' }], '15.16', LIVE)
    expect(runner).toEqual({ patch: '15.14', path: 'D:\\old', isLive: false })
  })

  it('ignores a hotfix difference, because Riot does', () => {
    // Both reduce to 15.16 before they get here; this is the whole point of the reduction.
    expect(runnerFor(patchFromGameVersion('15.16.700.1'), [], patchFromGameVersion('15.16.980.5'), LIVE))
      .toEqual({ patch: '15.16', path: LIVE, isLive: true })
  })

  it('is null when nothing can play it', () => {
    expect(runnerFor('15.14', [], '15.16', LIVE)).toBeNull()
  })

  it('is null when the replay\u2019s patch is unknown', () => {
    expect(runnerFor(null, [{ patch: '15.16', path: 'D:\\old' }], '15.16', LIVE)).toBeNull()
  })

  it('does not use the live install when its patch is unknown', () => {
    expect(runnerFor('15.16', [], null, LIVE)).toBeNull()
  })
})

describe('replayBlockedReason', () => {
  it('says nothing when it can be watched', () => {
    expect(replayBlockedReason('15.16', { patch: '15.16', path: LIVE, isLive: true })).toBeNull()
  })

  it('names the patch that is missing', () => {
    expect(replayBlockedReason('15.14', null)).toBe('Needs a League client for patch 15.14')
  })

  it('distinguishes an unreadable patch from a missing client', () => {
    expect(replayBlockedReason(null, null)).toMatch(/could not read/i)
  })
})
