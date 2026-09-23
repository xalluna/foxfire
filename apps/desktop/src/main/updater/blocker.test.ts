import { describe, expect, it } from 'vitest'
import { blockerFor } from './blocker'

describe('blockerFor', () => {
  it('lets the restart through when nothing is happening', () => {
    expect(blockerFor('none')).toBeNull()
  })

  it('holds it during a game', () => {
    expect(blockerFor('game')).toBe('game')
  })

  it('holds it during a game that is not being recorded, for the LP reading', () => {
    expect(blockerFor('stalled')).toBe('game')
  })

  it('names the recording when there is one, since that is what would be lost', () => {
    expect(blockerFor('recording')).toBe('recording')
  })
})
