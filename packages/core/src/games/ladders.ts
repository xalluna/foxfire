import type { GameId } from './registry'

/** League's two ladders. */
export type LolLadder = 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'

/** TFT's three. Riot calls Hyper Roll's `RANKED_TFT_TURBO`. */
export type TftLadder = 'RANKED_TFT' | 'RANKED_TFT_DOUBLE_UP' | 'RANKED_TFT_TURBO'

/**
 * A ranked ladder, by Riot's own name for it — which is what every database
 * stores, every reading carries and the League client reports.
 */
export type LadderId = LolLadder | TftLadder

/**
 * How a ladder measures somebody.
 *
 * `divisioned` is tier, division and LP, Iron IV to Challenger: League's two,
 * and TFT's Ranked and Double Up. `rated` is Hyper Roll's — a rating number
 * and a coloured tier the rating falls in, with no divisions and no LP. A
 * rated ladder's position is the rating itself; see ladderPositionFor.
 */
export type LadderScale = 'divisioned' | 'rated'

/** A ladder as a URL says it. */
export type LadderParam = 'solo' | 'flex' | 'tft' | 'double-up' | 'hyper-roll'

export interface LadderDefinition {
  id: LadderId
  game: GameId
  /** The queue whose games move it. */
  queueId: number
  /** "Ranked Solo/Duo" */
  label: string
  /** "Solo/Duo", where the game is already said. */
  shortLabel: string
  urlParam: LadderParam
  scale: LadderScale
  /** Whether the LP editor offers it. Only a ladder with LP can be typed. */
  lpEditable: boolean
  /**
   * How many places a game on it can finish in, for the placement spread.
   *
   * 0 for League, which is won or lost. 4 for Double Up, which is ranked by
   * team — two players to a team, four teams. 8 for the rest of TFT.
   */
  placementSlots: 0 | 4 | 8
}

function ladder(definition: LadderDefinition): LadderDefinition {
  return definition
}

export const LADDERS: Readonly<Record<LadderId, LadderDefinition>> = {
  RANKED_SOLO_5x5: ladder({
    id: 'RANKED_SOLO_5x5',
    game: 'lol',
    queueId: 420,
    label: 'Ranked Solo/Duo',
    shortLabel: 'Solo/Duo',
    urlParam: 'solo',
    scale: 'divisioned',
    lpEditable: true,
    placementSlots: 0
  }),
  RANKED_FLEX_SR: ladder({
    id: 'RANKED_FLEX_SR',
    game: 'lol',
    queueId: 440,
    label: 'Ranked Flex',
    shortLabel: 'Flex',
    urlParam: 'flex',
    scale: 'divisioned',
    lpEditable: true,
    placementSlots: 0
  }),
  RANKED_TFT: ladder({
    id: 'RANKED_TFT',
    game: 'tft',
    queueId: 1100,
    label: 'Ranked TFT',
    shortLabel: 'Ranked',
    urlParam: 'tft',
    scale: 'divisioned',
    lpEditable: true,
    placementSlots: 8
  }),
  RANKED_TFT_DOUBLE_UP: ladder({
    id: 'RANKED_TFT_DOUBLE_UP',
    game: 'tft',
    queueId: 1160,
    label: 'Double Up',
    shortLabel: 'Double Up',
    urlParam: 'double-up',
    scale: 'divisioned',
    lpEditable: true,
    placementSlots: 4
  }),
  RANKED_TFT_TURBO: ladder({
    id: 'RANKED_TFT_TURBO',
    game: 'tft',
    queueId: 1130,
    label: 'Hyper Roll',
    shortLabel: 'Hyper Roll',
    urlParam: 'hyper-roll',
    scale: 'rated',
    lpEditable: false,
    placementSlots: 8
  })
}

/** Every ladder, League's first and in the order a picker offers them. */
export const LADDER_IDS: readonly LadderId[] = [
  'RANKED_SOLO_5x5',
  'RANKED_FLEX_SR',
  'RANKED_TFT',
  'RANKED_TFT_DOUBLE_UP',
  'RANKED_TFT_TURBO'
]

/** One game's ladders, in picker order. */
export function laddersOf(game: GameId): LadderId[] {
  return LADDER_IDS.filter((id) => LADDERS[id].game === game)
}

/**
 * Whether a string names a ladder Foxfire tracks.
 *
 * Its own keys only: `in` would also say yes to `toString` and `constructor`,
 * which every object inherits, and the caller would read a ladder that is not
 * there.
 */
export function isLadderId(value: unknown): value is LadderId {
  return typeof value === 'string' && Object.hasOwn(LADDERS, value)
}

/** The ladder a queue id moves, or null for an unranked queue. */
export function ladderOfQueueId(queueId: number | null | undefined): LadderId | null {
  if (queueId === null || queueId === undefined) return null
  return LADDER_IDS.find((id) => LADDERS[id].queueId === queueId) ?? null
}

/** The ladder a URL names, or undefined. */
export function ladderOfParam(raw: unknown): LadderId | undefined {
  return LADDER_IDS.find((id) => LADDERS[id].urlParam === raw)
}
