/**
 * The games Foxfire tracks, and what makes each one itself.
 *
 * A game is a Riot title played on a Riot ID. The account — the PUUID, the
 * name, the server's claim on it — is shared, and everything that differs
 * between titles hangs off one of these: which queues it has, which of them
 * carry a ladder, how a recording of it is filed on disk, which Riot key
 * reaches its API, and what its matches look like.
 *
 * League was the only game for sixteen releases, and every list of queues was
 * written for it. Those lists are derived from here now (see rules/queues.ts),
 * and their League answers are pinned by a test so the move changed nothing.
 * A new Riot title is an entry here, its ladders in ladders.ts, and its own
 * match ingestion — see CLAUDE.md's Games section for the whole list.
 *
 * `fixtures/game-registry.json` is generated from this file and read by the
 * server's own copy, Foxfire.Core/Games.cs, so the two cannot disagree.
 */

export type GameId = 'lol' | 'tft'

/** Every game, in the order a switch offers them. */
export const GAME_IDS: readonly GameId[] = ['lol', 'tft']

/**
 * Which Riot key a game's API is called with.
 *
 * Riot ties a registered key to a product, and encrypts a PUUID per key. League
 * is always the main key. TFT uses its own key when one is configured — which
 * gives every account a second PUUID — and the main key otherwise.
 */
export type RiotKeyScope = 'main' | 'tft'

/** One queue as Foxfire names it. */
export interface QueueDefinition {
  id: number
  game: GameId
  /** As a filter or a video title reads it: "Ranked Solo/Duo". */
  label: string
  /**
   * The folder a recording of it is filed under, below the game's own.
   *
   * Spelled for Windows rather than for reading, so never a slash: Solo/Duo is
   * `Solo-Duo`. A queue with no entry here is filed under `Other`.
   */
  folder: string
  /** Offered by the history's queue filter. */
  filter: boolean
}

export interface GameDefinition {
  id: GameId
  /** "League of Legends" */
  name: string
  /** "League", as the switch on a player says it. */
  shortName: string
  /** The folder a recording is filed under, below the player's: `LoL`, `TFT`. */
  folder: string
  keyScope: RiotKeyScope
  /** The queues worth naming, in filter order. */
  queues: readonly QueueDefinition[]
  /**
   * The queue a history opens on, or null for every queue at once.
   *
   * League opens on Solo/Duo because mixing queues is what makes champion stats
   * untrustworthy. TFT has no per-unit table to protect, so it opens on all of
   * them.
   */
  defaultQueueFilter: number | null
  /**
   * When to look for a game the client has just said is over, from that moment.
   *
   * Riot publishes a match a few minutes after it ends. A TFT match is only
   * published once the whole lobby has finished, and somebody knocked out
   * early can be twenty minutes ahead of the last player standing — so its
   * retries run longer.
   */
  postGameRetryMs: readonly number[]
  /**
   * How long a recording may wait for its match before it is written off.
   *
   * Counted from the recording's end, for the same reason as the retries: a
   * TFT recording stops when its player is knocked out, and the match it
   * belongs to does not exist until the lobby is done.
   */
  bindGiveUpMs: number
}

const SECOND = 1_000
const MINUTE = 60 * SECOND

function queue(game: GameId, id: number, label: string, folder: string, filter = false): QueueDefinition {
  return { id, game, label, folder, filter }
}

const LOL_QUEUES: readonly QueueDefinition[] = [
  queue('lol', 420, 'Ranked Solo/Duo', 'Solo-Duo', true),
  queue('lol', 440, 'Ranked Flex', 'Flex', true),
  queue('lol', 400, 'Normal Draft', 'Normal-Draft', true),
  queue('lol', 430, 'Normal Blind', 'Normal-Blind', true),
  queue('lol', 450, 'ARAM', 'ARAM', true),
  queue('lol', 1700, 'Arena', 'Arena', true),
  queue('lol', 480, 'Swiftplay', 'Swiftplay'),
  queue('lol', 490, 'Quickplay', 'Quickplay'),
  queue('lol', 700, 'Clash', 'Clash'),
  queue('lol', 720, 'ARAM Clash', 'ARAM-Clash'),
  queue('lol', 900, 'ARURF', 'ARURF'),
  queue('lol', 1900, 'URF', 'URF'),
  queue('lol', 0, 'Custom', 'Custom')
]

const TFT_QUEUES: readonly QueueDefinition[] = [
  queue('tft', 1100, 'Ranked TFT', 'Ranked', true),
  queue('tft', 1160, 'Double Up', 'Double-Up', true),
  queue('tft', 1130, 'Hyper Roll', 'Hyper-Roll', true),
  queue('tft', 1090, 'Normal TFT', 'Normal', true)
]

export const GAMES: Readonly<Record<GameId, GameDefinition>> = {
  lol: {
    id: 'lol',
    name: 'League of Legends',
    shortName: 'League',
    folder: 'LoL',
    keyScope: 'main',
    queues: LOL_QUEUES,
    defaultQueueFilter: 420,
    postGameRetryMs: [30 * SECOND, 90 * SECOND, 3 * MINUTE, 6 * MINUTE, 10 * MINUTE],
    bindGiveUpMs: 30 * MINUTE
  },
  tft: {
    id: 'tft',
    name: 'Teamfight Tactics',
    shortName: 'TFT',
    folder: 'TFT',
    keyScope: 'tft',
    queues: TFT_QUEUES,
    defaultQueueFilter: null,
    postGameRetryMs: [1 * MINUTE, 3 * MINUTE, 6 * MINUTE, 10 * MINUTE, 15 * MINUTE, 20 * MINUTE],
    bindGiveUpMs: 90 * MINUTE
  }
}

const QUEUE_BY_ID = new Map<number, QueueDefinition>(
  GAME_IDS.flatMap((game) => GAMES[game].queues.map((q) => [q.id, q] as const))
)

/** A queue Foxfire has a name for, or undefined. */
export function queueDefinition(queueId: number | null | undefined): QueueDefinition | undefined {
  return queueId === null || queueId === undefined ? undefined : QUEUE_BY_ID.get(queueId)
}

/**
 * The game a queue id belongs to, or null for one Foxfire has no name for.
 *
 * Null rather than a guess. Riot runs event queues in both games under ids that
 * come and go, and only the client's own session says which game one is — see
 * gameOfLiveSession.
 */
export function gameOfQueueId(queueId: number | null | undefined): GameId | null {
  return queueDefinition(queueId)?.game ?? null
}

/** What the League client's gameflow session says about the game being played. */
export interface LiveSessionFacts {
  queueId?: number | null
  gameMode?: string | null
  mapId?: number | null
}

/** TFT is played on the Convergence, map 22, whatever the queue. */
const TFT_MAP_ID = 22

/**
 * Which game the League client is running.
 *
 * Both games are queued for and tracked through the League client — TFT's
 * game itself is a program of its own, Riot's Unreal client — so the client's
 * gameflow session is where they are told apart. The mode and map decide
 * before the queue does, because Riot opens TFT event queues under ids nobody
 * has listed — and an unknown queue with no TFT marker is League, which is
 * what every session was before TFT was a game here.
 */
export function gameOfLiveSession(facts: LiveSessionFacts): GameId {
  if (facts.gameMode?.toUpperCase() === 'TFT' || facts.mapId === TFT_MAP_ID) return 'tft'
  return gameOfQueueId(facts.queueId) ?? 'lol'
}

/** A game as a URL or a request says it, with anything unreadable treated as absent. */
export function parseGameId(raw: unknown): GameId | undefined {
  return raw === 'lol' || raw === 'tft' ? raw : undefined
}

/** The folder a recording of this queue is filed under, below its game's. */
export function queueFolder(game: GameId, queueId: number | null): string {
  const known = queueDefinition(queueId)
  return known && known.game === game ? known.folder : 'Other'
}
