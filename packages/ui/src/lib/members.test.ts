import { describe, expect, it } from 'vitest'
import { memberCountLabel } from './members'

describe('memberCountLabel', () => {
  it('counts everybody when nothing is typed', () => {
    expect(memberCountLabel(120, '')).toBe('120 members')
    expect(memberCountLabel(1, '   ')).toBe('1 member')
    expect(memberCountLabel(0, '')).toBe('0 members')
  })

  it('counts the matches while searching, not the rows on screen', () => {
    expect(memberCountLabel(3, 'fak')).toBe('3 matching')
    expect(memberCountLabel(0, 'nobody')).toBe('0 matching')
  })
})
