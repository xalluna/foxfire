import type { QueryKey } from '@tanstack/react-query'
import type { SyncProgressEvent } from '@foxfire/core'
import { queryKeys } from './keys'

/** Something that changed underneath the screens. */
export type DataEvent =
  | { kind: 'syncProgress'; event: SyncProgressEvent }
  | { kind: 'rankEdited'; accountId: string }
  | { kind: 'rankChanged'; accountId: string }
  | { kind: 'recordingChanged'; accountId: string; matchId: string }
  | { kind: 'seasonsSaved' }

/**
 * Which cached answers an event makes stale.
 *
 * A table rather than a handler per event so it can be read, and tested, as
 * one decision: what goes stale when this happens. It is the part that used to
 * be scattered across a hook per event, where a missing line meant a screen
 * quietly went on showing yesterday's number.
 */
export function invalidationsFor(event: DataEvent): QueryKey[] {
  switch (event.kind) {
    case 'syncProgress': {
      // Only a finished sync has anything new to show. It fires for automatic
      // syncs too, and has to: the post-game refresh is silent, so this is the
      // only thing that puts the finished game on screen.
      if (event.event.phase !== 'complete') return []

      // Scoped to the account the event is about. The bare prefix matched every
      // account's cached list and refetched all of them.
      const { accountId } = event.event
      return [
        queryKeys.matchList(accountId),
        queryKeys.dashboard(accountId),
        queryKeys.rankHistory(accountId),
        // Aggregated from the very matches a sync just imported, so stale the
        // moment it finishes rather than whenever the query ages out.
        queryKeys.championStats(accountId),
        // A sync can reach back into a year the account had no history for,
        // which adds an entry to both period pickers.
        queryKeys.rankPeriods(accountId)
      ]
    }

    case 'rankEdited':
      // Somebody typed LP — in another window, or on another machine. The
      // match row's chip and the rank graph both show it.
      return [
        queryKeys.rankHistory(event.accountId),
        queryKeys.matchList(event.accountId),
        queryKeys.dashboard(event.accountId)
      ]

    case 'rankChanged':
      // A League client recorded an LP change. Unscoped, as it always was: the
      // reading can settle a game on whichever account was playing, and a
      // refetch of a list nobody is looking at costs nothing.
      return [queryKeys.rankHistory(), queryKeys.matchLists(), queryKeys.dashboard()]

    case 'recordingChanged':
      // One account's row for one game, and the recording page if it is open.
      // Both live under that account's match list; the same game in anybody
      // else's history is somebody else's view of it and has not changed.
      return [queryKeys.matchList(event.accountId)]

    case 'seasonsSaved':
      // Every picker, every scoped aggregate and every LP chip is derived from
      // the season dates, so all of it is stale the moment they change.
      return [
        queryKeys.rankPeriods(),
        queryKeys.rankHistory(),
        queryKeys.championStats(),
        queryKeys.matchLists()
      ]
  }
}
