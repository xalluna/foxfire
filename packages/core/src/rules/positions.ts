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

/** A lane's place in POSITION_ORDER, or after all five for anything that is not one. */
export function positionIndex(value: string | null | undefined): number {
  return isPosition(value) ? POSITION_ORDER.indexOf(value) : POSITION_ORDER.length
}

/**
 * A team as a scoreboard reads it: top down to support.
 *
 * Neither source hands players over in that order — the server's are by puuid,
 * the desktop's by Riot's participant order — so it is decided here. The sort is
 * stable, so a lobby without lanes keeps the order it came in, and a player with
 * no lane in a laned game sits below the five rather than above them.
 */
export function inPositionOrder<T extends { teamPosition: string | null }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => positionIndex(a.teamPosition) - positionIndex(b.teamPosition))
}
