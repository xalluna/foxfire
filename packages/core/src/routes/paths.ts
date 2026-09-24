import type { QueueType, RankRange } from '../types'
import { parseSeasonRange } from '../rules/seasons'
import { playerSlug } from './slug'

/** Anybody with a Riot ID — an account on the server, or a participant in a game. */
export interface PlayerRef {
  gameName: string
  tagLine: string
}

/** The two ladders, as a URL says them. */
export type RankQueue = 'solo' | 'flex'

/** A ladder as a URL says it. */
export function rankQueueParam(queueType: QueueType): RankQueue {
  return queueType === 'RANKED_FLEX_SR' ? 'flex' : 'solo'
}

/** The inverse, with anything unreadable treated as absent. */
export function parseRankQueueParam(raw: unknown): QueueType | undefined {
  if (raw === 'solo') return 'RANKED_SOLO_5x5'
  if (raw === 'flex') return 'RANKED_FLEX_SR'
  return undefined
}

/**
 * A period as a URL says it, with anything unreadable treated as absent.
 *
 * A range is already text a URL can carry, so this only checks it is one — a
 * link naming a season that no longer exists still parses, and the screen says
 * there is nothing in it.
 */
export function parseRangeParam(raw: unknown): RankRange | undefined {
  if (raw === '7d' || raw === '30d' || raw === 'all') return raw
  if (typeof raw !== 'string') return undefined
  return parseSeasonRange(raw as RankRange) === null ? undefined : (raw as RankRange)
}

/**
 * A queue filter as a URL says it.
 *
 * A queue id, or `all` for no filter. Absent means the screen's own default,
 * which is Ranked Solo/Duo — so a link that means something else has to say so,
 * and every link these build does.
 */
export function queueParam(queueId: number | null): string {
  return queueId === null ? 'all' : String(queueId)
}

/** The inverse, with anything unreadable treated as absent. */
export function parseQueueParam(raw: unknown): number | null | undefined {
  if (raw === 'all') return null
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

function segment(value: string): string {
  return encodeURIComponent(value)
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value)
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

/**
 * Every place in Foxfire a link can point, as a path.
 *
 * Written once, here, because two things build these links and they must agree:
 * the web client's own navigation, and the desktop's "Copy link", which hands
 * somebody a URL into the web client of the server it is connected to. A path
 * the desktop built and the web client does not recognise would be a link that
 * opens on nothing.
 *
 * Paths only; the caller puts them on an origin — see absoluteUrl.
 */
export const paths = {
  home: () => '/',

  /**
   * Everybody this server tracks, optionally narrowed to a query.
   *
   * The finder lives here in the web client, so this is the address a shared
   * link to one carries. The desktop draws the same screen under its own
   * Search page; a link is always into the web client, which has one.
   */
  players: (query?: string) => withQuery('/players', { q: query || undefined }),

  /** A profile, and optionally one of its games opened in the history. */
  player: (player: PlayerRef, search: { queue?: number | null; match?: string } = {}) =>
    withQuery(`/players/${segment(playerSlug(player))}`, {
      queue: search.queue === undefined ? undefined : queueParam(search.queue),
      match: search.match
    }),

  champions: (player: PlayerRef, search: { queue?: number | null; range?: RankRange } = {}) =>
    withQuery(`/players/${segment(playerSlug(player))}/champions`, {
      queue: search.queue === undefined ? undefined : queueParam(search.queue),
      range: search.range
    }),

  rank: (player: PlayerRef, search: { queue?: RankQueue; range?: RankRange } = {}) =>
    withQuery(`/players/${segment(playerSlug(player))}/rank`, {
      queue: search.queue,
      range: search.range
    }),

  lpEditor: (player: PlayerRef, search: { queue: RankQueue; match?: string }) =>
    withQuery(`/players/${segment(playerSlug(player))}/lp`, {
      queue: search.queue,
      match: search.match
    }),

  /**
   * One player's recording of one game.
   *
   * Under the player rather than the match, because a recording is one
   * player's screen: the same game has a different recording, or none, in
   * each of its histories, and a link that did not say whose would have to
   * pick.
   */
  recording: (player: PlayerRef, matchId: string) =>
    `/players/${segment(playerSlug(player))}/recordings/${segment(matchId)}`,

  /** One game, optionally as one of its players saw it — their LP, their row picked out. */
  match: (matchId: string, search: { player?: PlayerRef } = {}) =>
    withQuery(`/matches/${segment(matchId)}`, {
      player: search.player ? playerSlug(search.player) : undefined
    }),

  invite: (token: string) => `/invite/${segment(token)}`,

  /**
   * Where a reset link lands. The server builds these itself when it describes
   * a reset — this is the same path, for anybody on this side who needs it.
   */
  resetPassword: (token: string) => `/reset-password/${segment(token)}`,

  signIn: (redirect?: string) => withQuery('/sign-in', { redirect })
}

/** A path on a server's public address, without a doubled or missing slash between them. */
export function absoluteUrl(publicUrl: string, path: string): string {
  return `${publicUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
