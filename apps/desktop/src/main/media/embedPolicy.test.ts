import { describe, expect, it } from 'vitest'
import { withoutFrameAncestors } from './embedPolicy'

describe('withoutFrameAncestors', () => {
  // Foxfire Media's own player policy (Embed/EmbedEndpoints.cs, PlayerPolicy).
  const PLAYER =
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; " +
    "connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; " +
    'frame-ancestors https://foxfire.example.com'

  it('takes frame-ancestors off and leaves every other directive as sent', () => {
    expect(withoutFrameAncestors(PLAYER)).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; " +
        "connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'"
    )
  })

  it('takes it off wherever it is, in any case, and leaves a policy without it alone', () => {
    expect(withoutFrameAncestors("FRAME-ANCESTORS 'none'; default-src 'self'")).toBe("default-src 'self'")
    expect(withoutFrameAncestors("default-src 'self'")).toBe("default-src 'self'")
  })
})
