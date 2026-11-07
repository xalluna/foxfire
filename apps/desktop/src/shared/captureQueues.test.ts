import { describe, expect, it } from 'vitest'
import { CAPTURE_QUEUE_GROUPS, CAPTURE_QUEUE_OPTIONS, shouldCapture } from './captureQueues'

/** What a new install records: League's two ranked queues. See captureSettings.ts. */
const DEFAULT_QUEUES = [420, 440]

describe('capture queues', () => {
  it('lists League’s queues and TFT’s, each under its own game', () => {
    expect(CAPTURE_QUEUE_GROUPS.map((group) => group.game)).toEqual(['lol', 'tft'])
    expect(CAPTURE_QUEUE_GROUPS[1]!.options.map((option) => option.value)).toEqual(
      expect.arrayContaining([1100, 1160, 1130])
    )
    expect(CAPTURE_QUEUE_OPTIONS).toHaveLength(
      CAPTURE_QUEUE_GROUPS[0]!.options.length + CAPTURE_QUEUE_GROUPS[1]!.options.length
    )
  })

  it('records no TFT until one of its queues is ticked', () => {
    expect(shouldCapture(1100, DEFAULT_QUEUES, false, 'tft')).toBe(false)
    expect(shouldCapture(1100, [...DEFAULT_QUEUES, 1100], false, 'tft')).toBe(true)
  })

  it('keeps League’s catch-all for League, not a TFT event queue nobody listed', () => {
    expect(shouldCapture(6_000, DEFAULT_QUEUES, true, 'tft')).toBe(false)
    expect(shouldCapture(2_400, DEFAULT_QUEUES, true, 'lol')).toBe(true)
    expect(shouldCapture(null, DEFAULT_QUEUES, true)).toBe(true)
  })

  it('still does not let the catch-all override an unticked League queue', () => {
    expect(shouldCapture(450, DEFAULT_QUEUES, true)).toBe(false)
  })
})
