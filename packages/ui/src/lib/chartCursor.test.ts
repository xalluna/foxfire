import { describe, expect, it } from 'vitest'
import { stepCursor } from './chartCursor'

describe('stepCursor', () => {
  it('comes in from the far side when nothing is under the cursor', () => {
    expect(stepCursor('ArrowRight', null, 30)).toBe(0)
    expect(stepCursor('ArrowLeft', null, 30)).toBe(29)
  })

  it('steps one reading at a time and stops at either end', () => {
    expect(stepCursor('ArrowLeft', 5, 30)).toBe(4)
    expect(stepCursor('ArrowRight', 5, 30)).toBe(6)
    expect(stepCursor('ArrowLeft', 0, 30)).toBe(0)
    expect(stepCursor('ArrowRight', 29, 30)).toBe(29)
  })

  it('takes up and down as right and left, as a slider does', () => {
    expect(stepCursor('ArrowUp', 5, 30)).toBe(6)
    expect(stepCursor('ArrowDown', 5, 30)).toBe(4)
  })

  it('jumps to the first and the latest reading', () => {
    expect(stepCursor('Home', 12, 30)).toBe(0)
    expect(stepCursor('End', null, 30)).toBe(29)
  })

  it('puts the cursor away on Escape, and leaves Escape alone when there is none', () => {
    expect(stepCursor('Escape', 12, 30)).toBeNull()
    expect(stepCursor('Escape', null, 30)).toBeUndefined()
  })

  it('leaves every other key, and a chart with nothing on it, alone', () => {
    expect(stepCursor('Tab', 3, 30)).toBeUndefined()
    expect(stepCursor('PageDown', 3, 30)).toBeUndefined()
    expect(stepCursor('ArrowLeft', null, 0)).toBeUndefined()
  })
})
