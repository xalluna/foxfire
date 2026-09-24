import { describe, expect, it } from 'vitest'
import { isSearchShortcut, moveHighlight } from './combobox'

describe('moveHighlight', () => {
  it('starts at the top going down and at the bottom going up', () => {
    expect(moveHighlight(null, 1, 5)).toBe(0)
    expect(moveHighlight(null, -1, 5)).toBe(4)
  })

  it('steps, and wraps round at either end', () => {
    expect(moveHighlight(1, 1, 5)).toBe(2)
    expect(moveHighlight(4, 1, 5)).toBe(0)
    expect(moveHighlight(0, -1, 5)).toBe(4)
  })

  it('highlights nothing in an empty list', () => {
    expect(moveHighlight(null, 1, 0)).toBeNull()
    expect(moveHighlight(3, -1, 0)).toBeNull()
  })
})

describe('isSearchShortcut', () => {
  const press = (key: string, held: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>>) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...held
  })

  it('is Ctrl+K, or Cmd+K, in either case', () => {
    expect(isSearchShortcut(press('k', { ctrlKey: true }))).toBe(true)
    expect(isSearchShortcut(press('K', { metaKey: true }))).toBe(true)
  })

  it('is not K alone, or with Shift or Alt held as well', () => {
    expect(isSearchShortcut(press('k', {}))).toBe(false)
    expect(isSearchShortcut(press('k', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isSearchShortcut(press('k', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(isSearchShortcut(press('j', { ctrlKey: true }))).toBe(false)
  })
})
