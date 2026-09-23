import { describe, expect, it } from 'vitest'
import { MINIMUM_PASSWORD, passwordProblem } from './password'

describe('passwordProblem', () => {
  const long = 'a-long-enough-password'

  it('accepts a password at the length the server asks for', () => {
    expect(passwordProblem('x'.repeat(MINIMUM_PASSWORD))).toBeNull()
  })

  it('refuses one character short', () => {
    expect(passwordProblem('x'.repeat(MINIMUM_PASSWORD - 1))).toContain(String(MINIMUM_PASSWORD))
  })

  it('says nothing about a confirmation when a form does not ask for one', () => {
    expect(passwordProblem(long)).toBeNull()
  })

  it('catches a mistyped confirmation', () => {
    expect(passwordProblem(long, `${long}x`)).toMatch(/do not match/i)
  })

  it('treats an empty confirmation as not yet matching', () => {
    expect(passwordProblem(long, '')).toMatch(/do not match/i)
  })

  it('accepts a confirmation that matches', () => {
    expect(passwordProblem(long, long)).toBeNull()
  })

  it('complains about the length before the match, since that is the fixable one', () => {
    expect(passwordProblem('short', 'other')).toContain(String(MINIMUM_PASSWORD))
  })
})
