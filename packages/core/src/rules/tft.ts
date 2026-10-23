/**
 * The arithmetic of a TFT game, as both clients and the desktop's own
 * database read it.
 *
 * Pure, like every other rule here. The one piece a server computes too —
 * Double Up's team placement — is pinned to Foxfire.Core's TftPlacements by
 * fixtures/game-registry.json.
 */

import { LADDERS, type TftLadder } from '../games/ladders'
import type { TftLadderSummary, TftTrait } from '../types/tft'

/** Double Up and Hyper Roll by queue, which is how a match row knows what it is. */
export const DOUBLE_UP_QUEUE_ID = 1160
export const HYPER_ROLL_QUEUE_ID = 1130

/**
 * The stage and round Riot's running round count stands for, as the client
 * shows it: `{ stage: 2, round: 1 }` is 2-1.
 *
 * Stage 1 has four rounds and every stage after it seven, which is what Riot's
 * own documentation describes: somebody knocked out at 2-1 has a last_round of
 * 5. Null for Hyper Roll, whose stages are shorter and whose count nobody has
 * pinned yet — a row there says "Round N" instead.
 */
export function stageOfRound(
  lastRound: number,
  queueId: number | null
): { stage: number; round: number } | null {
  if (queueId === HYPER_ROLL_QUEUE_ID || !Number.isInteger(lastRound) || lastRound < 1) return null
  if (lastRound <= 4) return { stage: 1, round: lastRound }
  return { stage: 2 + Math.floor((lastRound - 5) / 7), round: ((lastRound - 5) % 7) + 1 }
}

/** `1st`, `2nd`, `3rd`, `4th` … `11th`, `21st`. */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** What team placement is computed from: a lobby's players, as far as it cares. */
export interface PlacedPlayer {
  puuid: string
  placement: number
  partnerGroupId: number | null
}

/**
 * Each Double Up player's team placement, 1 to 4, by puuid.
 *
 * Teams are ranked by their best member's own placement. That is right
 * whichever way Riot reports Double Up — some payloads give both partners the
 * team's place and some give each their own — because in either form the team
 * that finished first holds the best number. A player with no partner group is
 * left out: there is no team to place.
 */
export function teamPlacements(players: readonly PlacedPlayer[]): Map<string, number> {
  const best = new Map<number, number>()
  for (const p of players) {
    if (p.partnerGroupId === null) continue
    best.set(p.partnerGroupId, Math.min(best.get(p.partnerGroupId) ?? Infinity, p.placement))
  }

  // Ties break on the group id so the answer never depends on input order.
  const order = [...best.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([group]) => group)

  const placed = new Map<string, number>()
  for (const p of players) {
    if (p.partnerGroupId === null) continue
    placed.set(p.puuid, order.indexOf(p.partnerGroupId) + 1)
  }
  return placed
}

/**
 * Whether a finish counts as the good half — a top four, or in Double Up a
 * top-two team. TFT's own word for it is a win.
 */
export function isTopHalf(board: { placement: number; teamPlacement: number | null }, queueId: number | null): boolean {
  if (queueId === DOUBLE_UP_QUEUE_ID && board.teamPlacement !== null) return board.teamPlacement <= 2
  return board.placement <= 4
}

/** The place a ladder counts: the team's in Double Up, the player's own everywhere else. */
export function countedPlacement(
  board: { placement: number; teamPlacement: number | null },
  queueId: number | null
): number {
  return queueId === DOUBLE_UP_QUEUE_ID && board.teamPlacement !== null ? board.teamPlacement : board.placement
}

/**
 * The traits a board had switched on, strongest first.
 *
 * By style — prismatic over gold over silver over bronze — then by how many
 * units carried it, then by name so two equal traits always come out in the
 * same order.
 */
export function activeTraits(traits: readonly TftTrait[]): TftTrait[] {
  return traits
    .filter((t) => t.style > 0)
    .sort((a, b) => b.style - a.style || b.numUnits - a.numUnits || a.name.localeCompare(b.name))
}

/** The one trait a board is remembered by, or null for a board with none active. */
export function strongestTrait(traits: readonly TftTrait[]): TftTrait | null {
  return activeTraits(traits)[0] ?? null
}

/**
 * A unit's cost from Riot's rarity, for when the manifest has no cost of its own.
 *
 * Riot's rarity skips numbers: since Set 9, 0, 1, 2, 4 and 6 are the one- to
 * five-cost units. Anything else is guessed as one more than the rarity and
 * held inside 1 to 5.
 */
export function unitCost(rarity: number): number {
  switch (rarity) {
    case 0:
      return 1
    case 1:
      return 2
    case 2:
      return 3
    case 4:
      return 4
    case 6:
      return 5
    default:
      return Math.min(Math.max(rarity + 1, 1), 5)
  }
}

const ID_PREFIX = /^(?:TFT\d*[A-Za-z]?|Set\d+|Item|Augment|Trait)_/i

/**
 * A readable name from a Riot id, for anything the manifest cannot name.
 *
 * `TFT13_Jinx` is Jinx, `TFT_Item_InfinityEdge` is Infinity Edge and
 * `TFT13_Augment_PandorasItems` is Pandoras Items. A unit from an older set
 * than the manifest still reads as something rather than as a code.
 */
export function tftDisplayName(id: string): string {
  let name = id
  while (ID_PREFIX.test(name)) name = name.replace(ID_PREFIX, '')
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Where a TFT game is placed among rank readings.
 *
 * At its player's own elimination rather than the lobby's end. TFT moves LP
 * the moment somebody is knocked out, and the last player standing can be
 * twenty minutes behind: placed at the lobby's end, a reading taken after an
 * early exit would land before the game and hand its LP to the one before.
 * The server's port is TftPlacements.GameEnd.
 */
export function tftGameEndMs(gameCreation: number, timeEliminatedSeconds: number | null, gameDurationSeconds: number): number {
  return gameCreation + Math.round((timeEliminatedSeconds ?? gameDurationSeconds) * 1000)
}

/** One finish, as a ladder summary counts it. */
export interface TftFinish {
  placement: number
  teamPlacement: number | null
  queueId: number | null
}

/**
 * One ladder's card: how many of the finishes were on it, how many at each
 * place it counts — the team's, #1 to #4, in Double Up — the average place, and
 * how often it was the top half.
 *
 * The caller chooses the finishes, which is the current set's on both sides.
 * The server's TftReads.LaddersAsync is the same rule.
 */
export function tftLadderSummary(ladder: TftLadder, finishes: readonly TftFinish[]): TftLadderSummary {
  const { queueId, placementSlots: slots } = LADDERS[ladder]
  const counted = finishes
    .filter((f) => f.queueId === queueId)
    .map((f) => countedPlacement(f, f.queueId))
    .filter((place) => place >= 1 && place <= slots)

  const placements = Array.from({ length: slots }, (_, i) => counted.filter((c) => c === i + 1).length)
  const games = counted.length

  return {
    queueType: ladder,
    games,
    placements,
    averagePlacement: games === 0 ? null : counted.reduce((sum, c) => sum + c, 0) / games,
    topRate: games === 0 ? null : counted.filter((c) => c <= slots / 2).length / games
  }
}
