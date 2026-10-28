import { describe, expect, it } from 'vitest'
import { chooseEncoder, hasWindowCapture, parseFfmpegVersion, probeArgs } from './encoders'

describe('choosing an encoder', () => {
  it("prefers the GPU vendor's own over Windows' Media Foundation", () => {
    expect(chooseEncoder(['mf', 'mf-hw', 'nvenc'])).toBe('nvenc')
    expect(chooseEncoder(['mf', 'amf'])).toBe('amf')
    expect(chooseEncoder(['mf', 'qsv', 'mf-hw'])).toBe('qsv')
  })

  it('falls back to Media Foundation on the GPU, then on the CPU', () => {
    expect(chooseEncoder(['mf', 'mf-hw'])).toBe('mf-hw')
    expect(chooseEncoder(['mf'])).toBe('mf')
  })

  it('has nothing to choose when nothing worked', () => {
    expect(chooseEncoder([])).toBeNull()
  })
})

describe('probing an encoder', () => {
  it('encodes a few frames to nowhere, at a size every encoder accepts', () => {
    const args = probeArgs('nvenc')
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'h264_nvenc', '-f', 'null', '-']))
    expect(args.join(' ')).toContain('color=c=black:s=1280x720')
  })

  it('asks Media Foundation for its hardware encoder only as mf-hw', () => {
    expect(probeArgs('mf-hw')).toEqual(expect.arrayContaining(['h264_mf', '-hw_encoding', '1']))
    expect(probeArgs('mf')).not.toContain('-hw_encoding')
  })
})

describe("FFmpeg's version", () => {
  it('is read off the version line', () => {
    expect(parseFfmpegVersion('ffmpeg version n9.0.2-36-g6882969ce9 Copyright (c) 2000-2026')).toBe(
      'n9.0.2-36-g6882969ce9'
    )
    expect(parseFfmpegVersion('not ffmpeg')).toBeNull()
  })

  it.each([
    ['n9.0.2-36-g6882969ce9', true],
    ['n8.1.3-24-g92611900bb', true],
    ['8.1', true],
    ['n8.0.1', false],
    ['7.1.1-essentials_build', false],
    // A build of the development branch, newer than every release.
    ['N-128122-g215351c1c3', true],
    [null, false]
  ])('%s has window capture: %s', (version, expected) => {
    expect(hasWindowCapture(version)).toBe(expected)
  })
})
