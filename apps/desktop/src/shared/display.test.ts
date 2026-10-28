import { describe, expect, it } from 'vitest'
import { DEFAULT_ZOOM, nearestZoom, stepZoom, zoomLabel, zoomShortcut, type ZoomKeyInput } from './display'

const key = (overrides: Partial<ZoomKeyInput>): ZoomKeyInput => ({
  type: 'keyDown',
  key: '',
  code: '',
  control: true,
  meta: false,
  alt: false,
  ...overrides
})

describe('nearestZoom', () => {
  it('reads nothing stored as 100%', () => {
    expect(nearestZoom(null)).toBe(DEFAULT_ZOOM)
    expect(nearestZoom(undefined)).toBe(DEFAULT_ZOOM)
    expect(nearestZoom(Number.NaN)).toBe(DEFAULT_ZOOM)
    expect(nearestZoom(0)).toBe(DEFAULT_ZOOM)
  })

  it('snaps to the closest step', () => {
    expect(nearestZoom(1.25)).toBe(1.25)
    expect(nearestZoom(1.2)).toBe(1.25)
    expect(nearestZoom(1.05)).toBe(1)
    expect(nearestZoom(3)).toBe(1.5)
    expect(nearestZoom(0.5)).toBe(1)
  })
})

describe('stepZoom', () => {
  it('walks the steps in order', () => {
    expect(stepZoom(1, 'in')).toBe(1.1)
    expect(stepZoom(1.1, 'in')).toBe(1.25)
    expect(stepZoom(1.25, 'in')).toBe(1.5)
    expect(stepZoom(1.5, 'out')).toBe(1.25)
  })

  it('stops at either end rather than wrapping', () => {
    expect(stepZoom(1.5, 'in')).toBe(1.5)
    expect(stepZoom(1, 'out')).toBe(1)
  })

  it('resets to 100% from anywhere', () => {
    expect(stepZoom(1.5, 'reset')).toBe(1)
  })

  it('steps from the nearest step when the current factor is between two', () => {
    expect(stepZoom(1.2, 'in')).toBe(1.5)
  })
})

describe('zoomShortcut', () => {
  it('answers the browser zoom keys', () => {
    expect(zoomShortcut(key({ key: '=', code: 'Equal' }))).toBe('in')
    expect(zoomShortcut(key({ key: '+', code: 'Equal' }))).toBe('in')
    expect(zoomShortcut(key({ key: '+', code: 'NumpadAdd' }))).toBe('in')
    expect(zoomShortcut(key({ key: '-', code: 'Minus' }))).toBe('out')
    expect(zoomShortcut(key({ key: '-', code: 'NumpadSubtract' }))).toBe('out')
    expect(zoomShortcut(key({ key: '0', code: 'Digit0' }))).toBe('reset')
  })

  it('ignores the same keys without Ctrl, with Alt, or on release', () => {
    expect(zoomShortcut(key({ key: '=', code: 'Equal', control: false }))).toBeNull()
    expect(zoomShortcut(key({ key: '=', code: 'Equal', alt: true }))).toBeNull()
    expect(zoomShortcut(key({ key: '=', code: 'Equal', type: 'keyUp' }))).toBeNull()
  })

  it('leaves every other shortcut alone', () => {
    expect(zoomShortcut(key({ key: 'r', code: 'KeyR' }))).toBeNull()
    expect(zoomShortcut(key({ key: '1', code: 'Digit1' }))).toBeNull()
  })
})

describe('zoomLabel', () => {
  it('writes a step as a percentage', () => {
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(1.1)).toBe('110%')
    expect(zoomLabel(1.25)).toBe('125%')
  })
})
