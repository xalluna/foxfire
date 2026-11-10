import { describe, expect, it } from 'vitest'
import {
  backoffMs,
  CHUNK_BYTES,
  classifyTusStatus,
  nextChunk,
  parseOffset,
  rateFrom,
  resolveLocation,
  uploadMetadata
} from './tusProtocol'

describe('uploadMetadata', () => {
  it('writes each value base64, the way tus spells it', () => {
    expect(uploadMetadata({ filename: '2026-11-10 20-14-03.mp4' })).toBe(
      `filename ${Buffer.from('2026-11-10 20-14-03.mp4').toString('base64')}`
    )
    expect(uploadMetadata({ a: 'x', b: 'y' })).toBe('a eA==,b eQ==')
  })
})

describe('parseOffset', () => {
  it('takes a whole number and nothing else', () => {
    expect(parseOffset('52428800')).toBe(52_428_800)
    expect(parseOffset(' 0 ')).toBe(0)
    expect(parseOffset(null)).toBeNull()
    expect(parseOffset('-1')).toBeNull()
    expect(parseOffset('1.5')).toBeNull()
    expect(parseOffset('abc')).toBeNull()
  })
})

describe('nextChunk', () => {
  it('sends fifty megabytes at a time, and what is left at the end', () => {
    const total = 120 * 1024 * 1024
    expect(nextChunk(0, total)).toEqual({ start: 0, length: CHUNK_BYTES })
    expect(nextChunk(100 * 1024 * 1024, total)).toEqual({ start: 100 * 1024 * 1024, length: 20 * 1024 * 1024 })
    expect(nextChunk(total, total).length).toBe(0)
  })
})

describe('resolveLocation', () => {
  it('reads an upload’s address, relative or absolute', () => {
    const endpoint = 'https://media.example.com/uploads/tus'
    expect(resolveLocation('/uploads/tus/abc', endpoint)).toBe('https://media.example.com/uploads/tus/abc')
    expect(resolveLocation('https://media.example.com/uploads/tus/abc', endpoint)).toBe(
      'https://media.example.com/uploads/tus/abc'
    )
    expect(resolveLocation(null, endpoint)).toBeNull()
  })
})

describe('classifyTusStatus', () => {
  it('starts over with a new token when the old one is spent or the upload is gone', () => {
    expect(classifyTusStatus(401, 'create').kind).toBe('renew')
    expect(classifyTusStatus(401, 'resume').kind).toBe('renew')
    expect(classifyTusStatus(404, 'resume').kind).toBe('renew')
  })

  it('asks again where it got to when the offsets disagree', () => {
    expect(classifyTusStatus(409, 'resume').kind).toBe('requery')
  })

  it('holds for a full disk, backs off for an outage, and gives up on what cannot work', () => {
    expect(classifyTusStatus(507, 'create').kind).toBe('full')
    expect(classifyTusStatus(503, 'resume').kind).toBe('backoff')
    expect(classifyTusStatus(429, 'resume').kind).toBe('backoff')
    expect(classifyTusStatus(0, 'resume').kind).toBe('backoff')
    expect(classifyTusStatus(413, 'create').kind).toBe('fatal')
    expect(classifyTusStatus(403, 'create').kind).toBe('fatal')
    expect(classifyTusStatus(404, 'create').kind).toBe('fatal')
  })
})

describe('backoffMs', () => {
  it('doubles from thirty seconds up to an hour', () => {
    const middle = () => 0.5
    expect(backoffMs(1, middle)).toBe(30_000)
    expect(backoffMs(2, middle)).toBe(60_000)
    expect(backoffMs(20, middle)).toBe(60 * 60_000)
  })
})

describe('rateFrom', () => {
  it('reads the rate off the last half minute of progress', () => {
    const samples = [
      { at: 0, bytes: 0 },
      { at: 10_000, bytes: 50_000_000 },
      { at: 20_000, bytes: 100_000_000 }
    ]
    expect(rateFrom(samples, 20_000)).toBe(5_000_000)
  })

  it('knows nothing from one sample, or from samples gone stale', () => {
    expect(rateFrom([{ at: 0, bytes: 0 }], 0)).toBeNull()
    expect(
      rateFrom(
        [
          { at: 0, bytes: 0 },
          { at: 1_000, bytes: 10 }
        ],
        120_000
      )
    ).toBeNull()
  })
})
