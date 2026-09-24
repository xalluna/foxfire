import { DEFAULT_QUEUE_FILTER, type QueueType, type RankRange } from '@foxfire/core'
import {
  parseQueueParam,
  parseRangeParam,
  parseRankQueueParam,
  rankQueueParam,
  type RankQueue
} from '@foxfire/core/routes'

/*
 * What each player page keeps in its URL, and how that turns into the props a
 * screen takes.
 *
 * A page's search is held the way the URL writes it — a queue id or `all`,
 * `solo` or `flex` — rather than as the `number | null` and QueueType the
 * screens take, because the router writes a search back into the URL exactly
 * as it holds it, and a null would come back as the text "null".
 *
 * Every validator returns only the keys that were present and readable. That is
 * load-bearing: "this link says nothing about the queue" and "this link clears
 * the queue" have to stay distinguishable for rememberSearch.
 */

/** A queue filter, as a search holds it: a queue id, or `all` for every queue. */
export type QueueSearch = number | 'all'

export interface DashboardSearch {
  queue?: QueueSearch
  /** A game to open in the history — once, and then dropped from the URL. */
  match?: string
}

export interface ChampionsSearch {
  queue?: QueueSearch
  /** Absent until somebody picks a period, so the page opens on the newest season with games. */
  range?: RankRange
}

export interface RankSearch {
  queue?: RankQueue
  range?: RankRange
}

export interface LpEditorSearch {
  queue?: RankQueue
  /** The game the editor was opened on. */
  match?: string
}

export interface MatchSearch {
  /** Whose game it was, as a player slug — their row and their LP, when this server knows them. */
  player?: string
}

type RawSearch = Record<string, unknown>

/** The period the rank page opens on. */
export const DEFAULT_RANK_RANGE: RankRange = '30d'

function readQueue(raw: unknown): QueueSearch | undefined {
  const queueId = parseQueueParam(raw)
  if (queueId === undefined) return undefined
  return queueId === null ? 'all' : queueId
}

function readRankQueue(raw: unknown): RankQueue | undefined {
  const queueType = parseRankQueueParam(raw)
  return queueType === undefined ? undefined : rankQueueParam(queueType)
}

function readText(raw: unknown): string | undefined {
  // A query value that looks like a number arrives as one. An id is text
  // either way, so it goes back to being text.
  if (typeof raw === 'number') return String(raw)
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function present<T extends object>(search: T): T {
  return Object.fromEntries(Object.entries(search).filter(([, value]) => value !== undefined)) as T
}

export function validateDashboardSearch(raw: RawSearch): DashboardSearch {
  return present({ queue: readQueue(raw.queue), match: readText(raw.match) })
}

export function validateChampionsSearch(raw: RawSearch): ChampionsSearch {
  return present({ queue: readQueue(raw.queue), range: parseRangeParam(raw.range) })
}

export function validateRankSearch(raw: RawSearch): RankSearch {
  return present({ queue: readRankQueue(raw.queue), range: parseRangeParam(raw.range) })
}

export function validateLpEditorSearch(raw: RawSearch): LpEditorSearch {
  return present({ queue: readRankQueue(raw.queue), match: readText(raw.match) })
}

export function validateMatchSearch(raw: RawSearch): MatchSearch {
  return present({ player: readText(raw.player) })
}

/** The queue filter a page shows for what its URL says. */
export function queueIdFrom(queue: QueueSearch | undefined): number | null {
  if (queue === undefined) return DEFAULT_QUEUE_FILTER
  return queue === 'all' ? null : queue
}

/**
 * What a URL should say for a queue filter somebody picked — nothing at all for
 * the default, so the ordinary view has the plain address.
 */
export function queueSearchFor(queueId: number | null): QueueSearch | undefined {
  if (queueId === DEFAULT_QUEUE_FILTER) return undefined
  return queueId === null ? 'all' : queueId
}

/** The ladder a page shows for what its URL says. Solo/Duo unless it says otherwise. */
export function queueTypeFrom(queue: RankQueue | undefined): QueueType {
  return parseRankQueueParam(queue) ?? 'RANKED_SOLO_5x5'
}

/** What a URL should say for a ladder somebody picked. */
export function rankQueueSearchFor(queueType: QueueType): RankQueue | undefined {
  return queueType === 'RANKED_SOLO_5x5' ? undefined : rankQueueParam(queueType)
}

/** What a URL should say for the rank page's period. */
export function rankRangeSearchFor(range: RankRange): RankRange | undefined {
  return range === DEFAULT_RANK_RANGE ? undefined : range
}
