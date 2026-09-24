/**
 * The five lanes, and the order a scoreboard reads them in.
 *
 * Lives in @foxfire/core rather than beside the icons in @foxfire/ui because it
 * is a rule about Riot's data rather than about drawing it, and the icon module
 * imports SVGs — which nothing outside a bundler can.
 *
 * The keys are the values match-v5 reports as `teamPosition`. A mode without
 * lanes reports an empty string there, and rather than enumerate the ways of
 * saying "no lane", anything outside the five is treated as absent.
 */
export const POSITION_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const

export type Position = (typeof POSITION_ORDER)[number]

export function isPosition(value: string | null | undefined): value is Position {
  return value !== null && value !== undefined && (POSITION_ORDER as readonly string[]).includes(value)
}
