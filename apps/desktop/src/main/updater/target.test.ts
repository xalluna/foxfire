import { describe, expect, it } from 'vitest'
import { pendingVerdict, resolveTarget } from './target'

const server = (recommended: string, name = 'Late Night'): { name: string; reachable: true; recommended: string } => ({
  name,
  reachable: true,
  recommended
})

describe('resolveTarget', () => {
  it('installs what the active server asks for', () => {
    expect(resolveTarget({ current: '0.14.0', server: server('0.15.0'), newest: '0.15.0' })).toEqual({
      kind: 'install',
      version: '0.15.0'
    })
  })

  it('installs the server\u2019s version and not a newer one it has never heard of', () => {
    expect(resolveTarget({ current: '0.14.0', server: server('0.15.0'), newest: '0.16.0' })).toEqual({
      kind: 'install',
      version: '0.15.0'
    })
  })

  it('says who is holding it back when the server is behind the newest release', () => {
    expect(resolveTarget({ current: '0.14.0', server: server('0.14.0'), newest: '0.15.0' })).toEqual({
      kind: 'held',
      serverName: 'Late Night',
      allows: '0.14.0',
      newest: '0.15.0'
    })
  })

  it('is current when the server and the newest release agree with this build', () => {
    expect(resolveTarget({ current: '0.14.0', server: server('0.14.0'), newest: '0.14.0' })).toEqual({
      kind: 'current'
    })
  })

  it('never goes backwards to meet a server running an older allow list', () => {
    expect(resolveTarget({ current: '0.15.0', server: server('0.14.0'), newest: '0.15.0' })).toEqual({
      kind: 'current'
    })
  })

  it('holds rather than guessing while the active server cannot be reached', () => {
    expect(
      resolveTarget({ current: '0.14.0', server: { name: 'Late Night', reachable: false }, newest: '0.15.0' })
    ).toEqual({ kind: 'unknown' })
  })

  it('takes the newest release in local-only mode', () => {
    expect(resolveTarget({ current: '0.14.0', server: null, newest: '0.15.0' })).toEqual({
      kind: 'install',
      version: '0.15.0'
    })
  })

  it('is current in local-only mode when nothing newer exists', () => {
    expect(resolveTarget({ current: '0.15.0', server: null, newest: '0.15.0' })).toEqual({ kind: 'current' })
  })

  it('does nothing when the newest release could not be read', () => {
    expect(resolveTarget({ current: '0.14.0', server: null, newest: null })).toEqual({ kind: 'unknown' })
  })

  it('refuses a version it cannot parse rather than trying to install it', () => {
    expect(resolveTarget({ current: '0.14.0', server: server('soon'), newest: null })).toEqual({
      kind: 'current'
    })
    expect(resolveTarget({ current: '0.14.0', server: null, newest: '0.15' })).toEqual({ kind: 'current' })
  })

  // Every way from one server to another passes through local-only, which
  // keeps the sign-in so coming back needs no password.
  it('in local-only mode, stays within the strictest server it is still signed in to', () => {
    expect(
      resolveTarget({
        current: '0.14.0',
        server: null,
        newest: '0.17.0',
        signedIn: [server('0.16.0', 'Fox Den'), server('0.15.0', 'Late Night')]
      })
    ).toEqual({ kind: 'install', version: '0.15.0' })
  })

  it('in local-only mode, says which signed-in server is holding the newest back', () => {
    expect(
      resolveTarget({ current: '0.15.0', server: null, newest: '0.17.0', signedIn: [server('0.15.0', 'Late Night')] })
    ).toEqual({ kind: 'held', serverName: 'Late Night', allows: '0.15.0', newest: '0.17.0' })
  })

  it('in local-only mode, holds while a server it is signed in to cannot be reached', () => {
    expect(
      resolveTarget({
        current: '0.14.0',
        server: null,
        newest: '0.17.0',
        signedIn: [server('0.16.0'), { name: 'Down', reachable: false }]
      })
    ).toEqual({ kind: 'unknown' })
  })

  it('takes the newest when signed in to no server at all', () => {
    expect(resolveTarget({ current: '0.14.0', server: null, newest: '0.17.0', signedIn: [] })).toEqual({
      kind: 'install',
      version: '0.17.0'
    })
  })
})

describe('pendingVerdict', () => {
  it('withdraws a download newer than the active server accepts', () => {
    expect(pendingVerdict({ pending: '0.17.0', server: server('0.16.0') })).toBe('withdraw')
  })

  it('keeps a download the active server accepts', () => {
    expect(pendingVerdict({ pending: '0.16.0', server: server('0.16.0') })).toBe('keep')
    expect(pendingVerdict({ pending: '0.15.0', server: server('0.16.0') })).toBe('keep')
  })

  it('withdraws while the active server cannot be asked', () => {
    expect(pendingVerdict({ pending: '0.16.0', server: { name: 'Down', reachable: false } })).toBe('withdraw')
  })

  it('withdraws the newest release downloaded on the way through local-only', () => {
    // Switched to this PC, which fetched the newest; the server it came from
    // and will go back to accepts less.
    expect(pendingVerdict({ pending: '0.17.0', server: null, signedIn: [server('0.16.0')] })).toBe('withdraw')
  })

  it('keeps the newest release on an install signed in to no server', () => {
    expect(pendingVerdict({ pending: '0.17.0', server: null, signedIn: [] })).toBe('keep')
    expect(pendingVerdict({ pending: '0.17.0', server: null })).toBe('keep')
  })
})
