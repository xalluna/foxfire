import { gameOfLiveSession, type GameId } from '@foxfire/core'

/*
 * The League client's gameflow session, read for which game is on.
 *
 * Both games are queued through the League client, which launches TFT's own
 * program for a TFT game, so the session is what tells them apart — its mode
 * and map before its queue, because Riot opens TFT event queues under ids
 * nobody has listed. Typed loosely: the session is large, undocumented, and
 * moves between patches.
 */

export interface GameflowSession {
  gameData?: {
    gameId?: number | null
    queue?: { id?: number | null; gameMode?: string | null; mapId?: number | null; type?: string | null } | null
  } | null
  map?: { id?: number | null; gameMode?: string | null } | null
}

/** What a game's session says about it, as the watcher and capture use it. */
export interface SessionFacts {
  game: GameId
  queueId: number | null
  /** Riot's id for the game, which with the platform is its match id: NA1_<gameId>. */
  gameId: number | null
}

export function sessionFacts(session: GameflowSession | null | undefined): SessionFacts {
  const queue = session?.gameData?.queue ?? null
  const queueId = queue?.id ?? null
  return {
    game: gameOfLiveSession({
      gameMode: queue?.gameMode ?? session?.map?.gameMode ?? null,
      mapId: queue?.mapId ?? session?.map?.id ?? null,
      queueId
    }),
    queueId,
    gameId: session?.gameData?.gameId ?? null
  }
}

/** How much of a session's raw JSON goes into the log. */
const RAW_LIMIT = 4_096

/**
 * A session as the log keeps it, once per game: what was read from it, the
 * keys it had, and the start of the raw thing.
 *
 * For checking against a real client what this file assumes about one — which
 * fields TFT fills in, and with what — without a debugger on somebody's PC.
 * The session holds nothing secret: queue and map data, and summoner names.
 */
export function describeSession(session: GameflowSession | null | undefined): Record<string, unknown> {
  const raw = JSON.stringify(session ?? null)
  return {
    ...sessionFacts(session),
    gameMode: session?.gameData?.queue?.gameMode ?? session?.map?.gameMode ?? null,
    mapId: session?.gameData?.queue?.mapId ?? session?.map?.id ?? null,
    queueType: session?.gameData?.queue?.type ?? null,
    keys: session ? Object.keys(session) : [],
    gameDataKeys: session?.gameData ? Object.keys(session.gameData) : [],
    raw: raw.length > RAW_LIMIT ? `${raw.slice(0, RAW_LIMIT)}…` : raw
  }
}
