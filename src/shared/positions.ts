/**
 * The five lanes, and the order a scoreboard reads them in.
 *
 * Lives in shared rather than beside the icons in the renderer because the main
 * process sorts live rosters by it, and the renderer's position module imports
 * SVGs — which main cannot.
 *
 * The keys are the values match-v5 reports as `teamPosition` and the Live
 * Client Data API reports as `position`, which agree on the five lanes and on
 * nothing else: a mode without lanes is an empty string from match-v5 and the
 * literal string "NONE" from the live client (confirmed in an ARAM). Rather
 * than enumerate the ways of saying "no lane", anything outside the five is
 * treated as absent.
 */
export const POSITION_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const

export type Position = (typeof POSITION_ORDER)[number]

export function isPosition(value: string | null | undefined): value is Position {
  return value !== null && value !== undefined && (POSITION_ORDER as readonly string[]).includes(value)
}

/**
 * Sorts a roster into lane order, leaving anything unrecognised at the end in
 * the order it arrived. A mode without lanes therefore keeps Riot's own
 * ordering rather than being shuffled into an arbitrary one.
 */
export function byPosition<T>(rows: T[], positionOf: (row: T) => string | null | undefined): T[] {
  const rank = (row: T): number => {
    const position = positionOf(row)
    return isPosition(position) ? POSITION_ORDER.indexOf(position) : POSITION_ORDER.length
  }
  // Array.prototype.sort is stable, so equal ranks — every unlaned row — hold
  // their relative order.
  return [...rows].sort((a, b) => rank(a) - rank(b))
}
