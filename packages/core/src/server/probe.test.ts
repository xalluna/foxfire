import { describe, expect, it } from 'vitest'
import { judge, probeServer } from './probe'

const DESKTOP = { kind: 'desktop', version: '0.13.0' } as const

describe('judge', () => {
  it('is fine with the newest build the server knows', () => {
    expect(judge('0.13.0', '0.12.0', '0.13.0')).toBe('ok')
  })

  it('nudges a build that is listed but behind', () => {
    expect(judge('0.12.0', '0.12.0', '0.13.0')).toBe('outdated')
  })

  it('refuses a build older than the server will serve', () => {
    expect(judge('0.11.0', '0.12.0', '0.13.0')).toBe('unsupported')
  })

  it("blames the server, not the build, when the build is newer than anything it knows", () => {
    // The server will refuse it and name the version it does know — an older
    // one. Installing that would be advice in the wrong direction.
    expect(judge('0.13.0', '0.12.0', '0.12.0')).toBe('server-outdated')
  })

  it('says nothing it cannot back up', () => {
    expect(judge('0.13', '0.12.0', '0.12.0')).toBe('unknown')
    expect(judge('0.13.0', 'soon', '0.12.0')).toBe('unknown')
  })
})

describe('probeServer', () => {
  const version = (extra: Record<string, unknown> = {}) =>
    (async () =>
      new Response(
        JSON.stringify({
          serverName: 'The Fox Den',
          serverVersion: '0.2.0',
          apiVersion: 1,
          minimumDesktop: '0.12.0',
          recommendedDesktop: '0.13.0',
          publicSignup: true,
          ...extra
        }),
        { status: 200 }
      )) as unknown as typeof fetch

  it("passes on where the server's web client lives, which Copy link builds on", async () => {
    const probe = await probeServer('https://fox.example', DESKTOP, {
      fetch: version({ apiBase: '/api', publicUrl: 'https://fox.example' })
    })

    expect(probe.publicUrl).toBe('https://fox.example')
    expect(probe.compatibility).toBe('ok')
  })

  it('has no public address from a server older than the web client', async () => {
    const probe = await probeServer('https://fox.example', DESKTOP, { fetch: version() })

    expect(probe.publicUrl).toBeNull()
  })
})
