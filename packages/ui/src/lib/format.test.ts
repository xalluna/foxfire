import { describe, expect, it } from 'vitest'
import { formatBytes, formatMs, formatUptime } from './format'

describe('formatMs', () => {
  it('reads a duration at the scale it is at', () => {
    expect(formatMs(null)).toBe('—')
    expect(formatMs(0)).toBe('0ms')
    expect(formatMs(0.4)).toBe('<1ms')
    expect(formatMs(42.6)).toBe('43ms')
    expect(formatMs(1_234)).toBe('1.23s')
    expect(formatMs(12_345)).toBe('12.3s')
    expect(formatMs(185_000)).toBe('3m 5s')
  })
})

describe('formatBytes', () => {
  it('climbs through the units', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2_048)).toBe('2.0 KB')
    expect(formatBytes(310 * 1024 * 1024)).toBe('310.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })
})

describe('formatUptime', () => {
  it('keeps the two units that say anything', () => {
    expect(formatUptime(42)).toBe('42s')
    expect(formatUptime(600)).toBe('10m')
    expect(formatUptime(3 * 3_600 + 125)).toBe('3h 2m')
    expect(formatUptime(2 * 86_400 + 5 * 3_600)).toBe('2d 5h')
  })
})
