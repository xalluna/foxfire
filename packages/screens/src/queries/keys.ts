import type { QueueType, RankRange, RiotIdInput } from '@foxfire/core'

/**
 * Every query key the screens use, in one place.
 *
 * They used to be string arrays written inline beside each fetch, which made
 * refreshing a matter of convention: an event invalidated `['matchList', id]`
 * because somebody knew the list was keyed that way. Two screens drifted apart
 * without anyone noticing — the admin settings were cached under two different
 * keys by the two pages that showed them, so saving on one left the other
 * stale. A key is built here or not at all.
 *
 * Each builder is a prefix of the one below it, so invalidating a shorter key
 * refreshes everything underneath: `matchList(id)` catches every queue's page
 * of that account's history, and `matchLists()` every account's.
 */
export const queryKeys = {
  /**
   * Every account query — yours, the home one, and each looked up by id or
   * Riot ID — so linking, unlinking or moving home refreshes all of them.
   */
  accounts: () => ['accounts'] as const,
  myAccounts: () => ['accounts', 'mine'] as const,
  homeAccount: () => ['accounts', 'home'] as const,
  account: (accountId: string) => ['accounts', 'id', accountId] as const,
  /** Riot IDs are not case-sensitive, so neither is the key. */
  accountByRiotId: (riotId: RiotIdInput) =>
    ['accounts', 'riotId', `${riotId.gameName}#${riotId.tagLine}`.toLowerCase()] as const,

  connection: () => ['connection'] as const,
  assets: () => ['assets'] as const,

  /** Every finder query, so one invalidation clears them all. */
  playerSearches: () => ['playerSearch'] as const,
  /**
   * One finder list: the search box's suggestions for what was typed, your own
   * accounts it opens on, or the admin's paged list of claims.
   */
  playerSearch: (query: string, scope: 'suggest' | 'mine' | 'claimed') => ['playerSearch', scope, query] as const,

  /** The players this machine or browser starred. Kept on the device, so only it changes them. */
  favorites: () => ['favorites'] as const,

  dashboard: (accountId?: string) =>
    accountId === undefined ? (['dashboard'] as const) : (['dashboard', accountId] as const),

  matchLists: () => ['matchList'] as const,
  matchList: (accountId: string, queueId?: number | null) =>
    queueId === undefined
      ? (['matchList', accountId] as const)
      : (['matchList', accountId, queueId] as const),

  /**
   * One game as one player's row. Under that player's match list, so whatever
   * refreshes their history — a sync finishing, LP typed in — refreshes it too.
   */
  matchSummary: (accountId: string, matchId: string) => ['matchList', accountId, 'match', matchId] as const,

  /**
   * One player's recording of one game, markers and all. Under their match list
   * too, so the refresh that puts a recording on the row reaches the page
   * playing it.
   */
  matchRecording: (accountId: string, matchId: string) =>
    ['matchList', accountId, 'recording', matchId] as const,

  matchDetail: (matchId: string) => ['matchDetail', matchId] as const,

  rankHistory: (accountId?: string, queueType?: QueueType, range?: RankRange) =>
    [
      'rankHistory',
      ...(accountId === undefined ? [] : [accountId]),
      ...(queueType === undefined ? [] : [queueType]),
      ...(range === undefined ? [] : [range])
    ] as const,

  rankPeriods: (accountId?: string) =>
    accountId === undefined ? (['rankPeriods'] as const) : (['rankPeriods', accountId] as const),

  championStats: (accountId?: string, queueId?: number | null, range?: RankRange) =>
    [
      'championStats',
      ...(accountId === undefined ? [] : [accountId]),
      ...(queueId === undefined ? [] : [queueId]),
      ...(range === undefined ? [] : [range])
    ] as const,

  editableMatches: (accountId: string, queueType: QueueType) =>
    ['editableMatches', accountId, queueType] as const,

  seasons: () => ['seasons'] as const,

  admin: {
    all: () => ['admin'] as const,
    /** Every page of the members, or of those matching `q` when one is given. */
    users: (q?: string) =>
      q === undefined ? (['admin', 'users'] as const) : (['admin', 'users', q] as const),
    /** Both invite lists, so one invalidation refreshes the open and the used. */
    invites: () => ['admin', 'invites'] as const,
    openInvites: () => ['admin', 'invites', 'open'] as const,
    usedInvites: () => ['admin', 'invites', 'used'] as const,
    settings: () => ['admin', 'settings'] as const,
    storage: () => ['admin', 'storage'] as const,
    replays: () => ['admin', 'replays'] as const
  }
}
