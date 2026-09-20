import { describe, expect, it, beforeEach } from 'vitest'
import { describeError, hashId, redact, redactJson, scrubString, setHashSalt } from './redact'

/**
 * The consequential tests in this subsystem.
 *
 * Everything else here is a developer tool where a bug is visible and cheap.
 * A redaction bug is neither: it writes a live API key or a player identifier
 * to a file on disk, silently, and the file is exactly the thing you would
 * paste into an issue when asking for help.
 */

const REAL_KEY = 'RGAPI-1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f'
const PUUID = 'k9wLYHkPX8Yq3ZfTn2vB1mQeR7sUiO0pAsDfGhJkLzXcVbNm4QwErTyUiOpAsDfGhJkLzXcVbN'

beforeEach(() => {
  setHashSalt('test-salt')
})

function serialise(value: unknown): string {
  return JSON.stringify(redact(value))
}

describe('scrubString', () => {
  it('removes a Riot key formatted into a message', () => {
    const scrubbed = scrubString(`request failed with key ${REAL_KEY} attached`)
    expect(scrubbed).not.toContain('RGAPI-')
    expect(scrubbed).toContain('[redacted]')
  })

  it('removes a key embedded in a URL query', () => {
    expect(scrubString(`https://na1.api.riotgames.com/x?api_key=${REAL_KEY}`)).not.toContain('RGAPI')
  })

  it('truncates very long strings', () => {
    expect(scrubString('x'.repeat(5_000)).length).toBeLessThan(600)
  })
})

describe('redact', () => {
  it('redacts sensitive keys whatever their casing or punctuation', () => {
    const output = serialise({
      'X-Riot-Token': REAL_KEY,
      authorization: 'Bearer abc',
      apiKey: REAL_KEY,
      api_key: REAL_KEY,
      Cookie: 'session=1',
      password: 'hunter2'
    })

    expect(output).not.toContain('RGAPI')
    expect(output).not.toContain('hunter2')
    expect(output).not.toContain('Bearer')
    expect(output).not.toContain('session=1')
  })

  it('keeps ordinary fields', () => {
    const output = redact({ endpoint: '/lol/match/v5', status: 200, ok: true }) as Record<
      string,
      unknown
    >
    expect(output).toEqual({ endpoint: '/lol/match/v5', status: 200, ok: true })
  })

  it('reaches a key hidden inside a nested Error cause chain', () => {
    // This is the leak path a shallow header denylist misses: fetch wraps the
    // original failure, and something upstream stringified the request.
    const inner = new Error('socket closed')
    ;(inner as { cause?: unknown }).cause = { headers: { 'X-Riot-Token': REAL_KEY } }
    const outer = new Error('fetch failed')
    ;(outer as { cause?: unknown }).cause = inner

    expect(serialise(outer)).not.toContain('RGAPI')
  })

  it('does not store stack traces', () => {
    expect(serialise(new Error('boom'))).not.toContain('at ')
  })

  it('survives a circular reference', () => {
    const node: Record<string, unknown> = { name: 'a' }
    node.self = node
    expect(() => serialise(node)).not.toThrow()
    expect(serialise(node)).toContain('[circular]')
  })

  it('bounds depth rather than recursing forever', () => {
    let deep: Record<string, unknown> = { value: 1 }
    for (let i = 0; i < 40; i += 1) deep = { nested: deep }
    expect(serialise(deep)).toContain('[depth]')
  })

  it('caps very long arrays', () => {
    const output = redact(Array.from({ length: 500 }, (_, i) => i)) as unknown[]
    expect(output.length).toBeLessThanOrEqual(50)
  })
})

describe('hashId', () => {
  it('is stable for the same input', () => {
    expect(hashId(PUUID)).toBe(hashId(PUUID))
  })

  it('never contains the input', () => {
    expect(hashId(PUUID)).not.toContain(PUUID.slice(0, 12))
  })

  it('differs between inputs', () => {
    expect(hashId('NA1_1')).not.toBe(hashId('NA1_2'))
  })

  it('changes with the salt, so hashes cannot be precomputed against a guess', () => {
    const salted = hashId('NA1_5327108453')
    setHashSalt('a-different-install')
    expect(hashId('NA1_5327108453')).not.toBe(salted)
  })
})

describe('describeError', () => {
  it('scrubs a key out of the message', () => {
    const described = describeError(new Error(`bad key ${REAL_KEY}`))
    expect(described.kind).toBe('Error')
    expect(described.message).not.toContain('RGAPI')
  })

  it('handles values that are not Errors', () => {
    expect(describeError('plain string').message).toBe('plain string')
    expect(describeError(undefined).kind).toBe('undefined')
  })
})

describe('redactJson', () => {
  it('returns null rather than throwing on unserialisable input', () => {
    const bad = { get boom(): never { throw new Error('nope') } }
    expect(() => redactJson(bad)).not.toThrow()
  })

  it('produces parseable JSON', () => {
    const json = redactJson({ a: 1, token: REAL_KEY })
    expect(json).not.toBeNull()
    expect(JSON.parse(json as string)).toEqual({ a: 1, token: '[redacted]' })
  })
})
