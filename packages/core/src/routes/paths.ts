import type { RankRange } from '../types'
import { playerSlug } from './slug'

/** Anybody with a Riot ID — an account on the server, or a participant in a game. */
export interface PlayerRef {
  gameName: string
  tagLine: string
}

/** The two ladders, as a URL says them. */
export type RankQueue = 'solo' | 'flex'

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

  players: () => '/players',

  player: (player: PlayerRef, search: { queue?: number | null } = {}) =>
    withQuery(`/players/${segment(playerSlug(player))}`, {
      queue: search.queue === undefined ? undefined : queueParam(search.queue)
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

  /** One game, optionally as one of its players saw it — their LP, their row picked out. */
  match: (matchId: string, search: { player?: PlayerRef } = {}) =>
    withQuery(`/matches/${segment(matchId)}`, {
      player: search.player ? playerSlug(search.player) : undefined
    }),

  search: (player?: PlayerRef) =>
    withQuery('/search', { q: player ? `${player.gameName}#${player.tagLine}` : undefined }),

  invite: (token: string) => `/invite/${segment(token)}`,

  signIn: (redirect?: string) => withQuery('/sign-in', { redirect })
}

/** A path on a server's public address, without a doubled or missing slash between them. */
export function absoluteUrl(publicUrl: string, path: string): string {
  return `${publicUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
