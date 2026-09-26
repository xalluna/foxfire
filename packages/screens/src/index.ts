/**
 * @foxfire/screens — the screens both clients mount, wired to data.
 *
 * Each screen reads through the FoxfireClient it was handed and draws with
 * @foxfire/ui. What the machine underneath can do beyond that — open a
 * recording, launch a replay, download a file — arrives as the Platform, and
 * anything a platform cannot do is simply not offered.
 *
 * A screen takes the state that decides what it shows as props. The player
 * pages both clients share are also offered as routes, built by
 * createPlayerRoutes, so the two agree on every path and search param; which
 * other screens exist and where they are mounted is each app's decision.
 */

export { ScreensProvider } from './ScreensProvider'
export {
  ClientProvider,
  PlatformProvider,
  useClient,
  usePlatform,
  type ActionOutcome,
  type Platform,
  type RecordingTarget
} from './client/context'
export { useConnection, useIsHeadAdmin, useIsServerAdmin } from './client/useConnection'
export { useShareLink, type ShareLink } from './client/useShareLink'
export { useDataEvents } from './client/useDataEvents'

export { queryKeys } from './queries/keys'
export { useAccount, useAccountByRiotId, useHomeAccount, useMyAccounts } from './queries/accounts'
export {
  FAVORITES_FULL,
  useFavorites,
  useFavoritesRefresher,
  useRefreshFavorites,
  useToggleFavorite,
  type Favorites
} from './queries/favorites'
export { invalidationsFor, type DataEvent } from './queries/invalidations'
export { createQueryClient } from './queries/queryClient'
export { nextOffset, pageItems, pageTotal } from './queries/paging'
export { isSyncing, useSyncProgress, useSyncProgressStore } from './store/syncProgress'

export {
  downloadBlockedReason,
  lpEditBlockedReason,
  lpWriteBlockedReason,
  matchContextItems,
  recordingBlockedReason,
  replayBlockedReason,
  withoutServerRecording,
  type MatchMenuActions,
  type MatchMenuContext
} from './match/matchMenu'
export { MatchDetailPanel } from './match/MatchDetailPanel'
export { useRecordingActions } from './match/useRecordingActions'

export { ChampionsScreen } from './screens/ChampionsScreen'
export { DashboardScreen } from './screens/DashboardScreen'
export { LpEditorScreen } from './screens/LpEditorScreen'
export { MatchScreen } from './screens/MatchScreen'
export { RankScreen } from './screens/RankScreen'
export { RecordingScreen, headerFactsFor } from './screens/RecordingScreen'
export { SeasonsCard } from './screens/SeasonsCard'
export { ServerDataScreen } from './screens/ServerDataScreen'
export { InvitesScreen } from './screens/InvitesScreen'
export { LeagueAccountsScreen } from './screens/LeagueAccountsScreen'
export { MembersScreen } from './screens/MembersScreen'
export { ServerInsightsScreen } from './screens/ServerInsightsScreen'

export {
  createPlayerRoutes,
  usePlayer,
  type PlayerLayoutProps,
  type PlayerRoutesOptions
} from './routes/players'
export { createMatchRoute } from './routes/match'
export {
  DEFAULT_RANK_RANGE,
  queueIdFrom,
  queueSearchFor,
  queueTypeFrom,
  rankQueueSearchFor,
  rankRangeSearchFor,
  validateChampionsSearch,
  validateDashboardSearch,
  validateLpEditorSearch,
  validateMatchSearch,
  validateRankSearch,
  type ChampionsSearch,
  type DashboardSearch,
  type LpEditorSearch,
  type MatchSearch,
  type QueueSearch,
  type RankSearch
} from './routes/params'
export { rememberSearch, type SearchMemory } from './routes/rememberSearch'
export { parseSearch, stringifySearch } from './routes/serialize'
export { useRouteSearch, type SearchUpdateOptions } from './routes/useRouteSearch'

export { PlayerSearchBox } from './search/PlayerSearchBox'
export { MIN_QUERY_LENGTH, SUGGESTION_LIMIT, searchShortcutLabel } from './search/searchView'
export { TYPING_PAUSE_MS, useDebounced } from './hooks/useDebounced'
