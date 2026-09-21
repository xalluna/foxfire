/**
 * @foxfire/screens — the screens both clients mount, wired to data.
 *
 * Each screen reads through the FoxfireClient it was handed and draws with
 * @foxfire/ui. What the machine underneath can do beyond that — open a
 * recording, launch a replay, download a file — arrives as the Platform, and
 * anything a platform cannot do is simply not offered.
 *
 * Which screens exist, where they are mounted and what state lives in a URL is
 * each app's decision; a screen takes that state as props.
 */

export { ScreensProvider } from './ScreensProvider'
export {
  ClientProvider,
  PlatformProvider,
  useClient,
  usePlatform,
  type ActionOutcome,
  type Platform
} from './client/context'
export { useConnection, useIsServerAdmin } from './client/useConnection'
export { useDataEvents } from './client/useDataEvents'

export { queryKeys } from './queries/keys'
export { invalidationsFor, type DataEvent } from './queries/invalidations'
export { createQueryClient } from './queries/queryClient'
export { isSyncing, useSyncProgress, useSyncProgressStore } from './store/syncProgress'

export {
  downloadBlockedReason,
  lpEditBlockedReason,
  lpWriteBlockedReason,
  matchContextItems,
  recordingBlockedReason,
  replayBlockedReason,
  type MatchMenuActions
} from './match/matchMenu'
export { MatchDetailPanel } from './match/MatchDetailPanel'

export { ChampionsScreen } from './screens/ChampionsScreen'
export { DashboardScreen } from './screens/DashboardScreen'
export { LpEditorScreen } from './screens/LpEditorScreen'
export { RankScreen } from './screens/RankScreen'
export { SearchScreen } from './screens/SearchScreen'
export { SeasonsCard } from './screens/SeasonsCard'
export { ServerDataScreen } from './screens/ServerDataScreen'
export { ServerManagementScreen } from './screens/ServerManagementScreen'
