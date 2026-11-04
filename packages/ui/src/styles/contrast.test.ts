/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ratedTierColor, tierColor } from '../lib/rank'

/**
 * Every colour text is written in, held to WCAG AA against every background it
 * is written on, read straight out of the stylesheet that ships.
 *
 * The palette was Riot's until 0.17.0, and Riot's greys put secondary text at
 * 2.5:1 and a field's outline at barely more than 1:1. This is what keeps a
 * tweak to a token from quietly going back there.
 */

type Rgb = [number, number, number]

// Off the disk rather than through `?raw`: vitest hands a stylesheet import
// back empty, whatever the query.
const css = readFileSync(new URL('./foxfire.css', import.meta.url), 'utf8')

const tokens: Record<string, Rgb> = Object.fromEntries(
  [...css.matchAll(/--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)].map((m) => [m[1], [+m[2], +m[3], +m[4]] as Rgb])
)

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!match) throw new Error(`not a hex colour: ${value}`)
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const BACKGROUNDS = ['canvas', 'surface', 'surface-2']

/** Normal-size text. */
const TEXT = 4.5
/** The outline of a control, and the graphics that carry meaning. */
const NON_TEXT = 3

const TEXT_TOKENS = ['text', 'text-dim', 'text-mute', 'accent', 'teal', 'red', 'amber', 'gold']
const EDGE_TOKENS = ['edge', 'accent-dim']

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']
const RATED_TIERS = ['GRAY', 'GREEN', 'BLUE', 'PURPLE', 'ORANGE']

describe('the palette', () => {
  it('reads every token it is asked about', () => {
    for (const name of [...BACKGROUNDS, ...TEXT_TOKENS, ...EDGE_TOKENS, 'hairline']) {
      expect(tokens[name], name).toBeDefined()
    }
  })

  for (const background of BACKGROUNDS) {
    describe(`on ${background}`, () => {
      it.each(TEXT_TOKENS)('%s is readable as text', (name) => {
        expect(contrast(tokens[name], tokens[background])).toBeGreaterThanOrEqual(TEXT)
      })

      it.each(EDGE_TOKENS)('%s is visible as a control outline', (name) => {
        expect(contrast(tokens[name], tokens[background])).toBeGreaterThanOrEqual(NON_TEXT)
      })

      it.each(TIERS)('%s is readable as a tier name', (tier) => {
        expect(contrast(hex(tierColor(tier)), tokens[background])).toBeGreaterThanOrEqual(TEXT)
      })

      it.each(RATED_TIERS)('rated %s is readable as a tier name', (tier) => {
        expect(contrast(hex(ratedTierColor(tier)), tokens[background])).toBeGreaterThanOrEqual(TEXT)
      })

      // Not a control's outline, so not held to 3:1, but a panel's edge has to
      // be a line somebody can see, not one that is only there in the source.
      it('hairline is a visible line', () => {
        expect(contrast(tokens.hairline, tokens[background])).toBeGreaterThanOrEqual(1.5)
      })
    })
  }

  it('keeps secondary text a step below the dim text above it', () => {
    for (const background of BACKGROUNDS) {
      const dim = contrast(tokens['text-dim'], tokens[background])
      const mute = contrast(tokens['text-mute'], tokens[background])
      expect(dim - mute, background).toBeGreaterThanOrEqual(1.5)
    }
  })
})
