import type { QueueType, RankRange } from '@foxfire/core'

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
  accounts: () => ['accounts'] as const,
  connection: () => ['connection'] as const,
  assets: () => ['assets'] as const,

  dashboard: (accountId?: string) =>
    accountId === undefined ? (['dashboard'] as const) : (['dashboard', accountId] as const),

  matchLists: () => ['matchList'] as const,
  matchList: (accountId: string, queueId?: number | null) =>
    queueId === undefined
      ? (['matchList', accountId] as const)
      : (['matchList', accountId, queueId] as const),

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
    users: () => ['admin', 'users'] as const,
    invites: () => ['admin', 'invites'] as const,
    settings: () => ['admin', 'settings'] as const,
    storage: () => ['admin', 'storage'] as const,
    replays: () => ['admin', 'replays'] as const
  }
}
