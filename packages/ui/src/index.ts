/**
 * @foxfire/ui — how Foxfire looks, and nothing about where its data comes from.
 *
 * Components and pages here take what they draw as props and report what the
 * person did through callbacks. None of them fetches, subscribes, or knows
 * whether it is running in the desktop app or a browser; @foxfire/screens
 * wires them to data, and each app decides which screens exist.
 *
 * Local UI state is fine here — a sort order, a half-typed draft, whether a
 * menu is open. What is not is anything a second screen or a server would
 * need to agree with.
 */

// Context
export { AssetManifestProvider, useAssetManifest } from './context/assetManifest'

// Components
export { AccountRail } from './components/AccountRail'
export { Asset } from './components/Asset'
export { Bar, type BarTone } from './components/Bar'
export { cardFooterLinkClass } from './components/CardFooter'
export { ChampionRecordRow, type ChampionRecord } from './components/ChampionRecordRow'
export { ChampionsCard, type ChampionsCardProps } from './components/ChampionsCard'
export {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuState
} from './components/ContextMenu'
export { CopyLinkButton } from './components/CopyLinkButton'
export { ConfirmDialog, Dialog, DialogActions } from './components/Dialog'
export { Disclaimer } from './components/Disclaimer'
export { EmptyState } from './components/EmptyState'
export { ShowMoreButton } from './components/ShowMore'
export { ErrorBoundary } from './components/ErrorBoundary'
export { ItemStrip } from './components/ItemStrip'
export { Logo } from './components/Logo'
export { LpChip } from './components/LpChip'
export { MatchDetailTable } from './components/MatchDetailTable'
export { MatchListRow } from './components/MatchListRow'
export { PlayerSearch, type PlayerSearchProps, type PlayerSearchSection } from './components/PlayerSearch'
export { ProfileHeader } from './components/ProfileHeader'
export { ProfileMarks, type FavoriteMark, type HomeMark } from './components/ProfileMarks'
export { ProfileStrip } from './components/ProfileStrip'
export { QueueFilter } from './components/QueueFilter'
export { RankCard, type RankCardDetail } from './components/RankCard'
export { RankChart } from './components/RankChart'
export { RankTrendChart } from './components/RankTrendChart'
export { RecentSummary } from './components/RecentSummary'
export { Segmented } from './components/Segmented'
export { MatchListSkeleton, MatchRowSkeleton, Skeleton } from './components/Skeleton'
export { SyncProgressBar } from './components/SyncProgressBar'
export { TierProgressTrack } from './components/TierProgressTrack'
export { ChartCard, TimeSeriesChart, type Series } from './components/TimeSeriesChart'
export * as Icon from './components/icons'

// Recordings
export { AttachLinkDialog } from './recording/AttachLinkDialog'
export { EventTimeline } from './recording/EventTimeline'
export {
  INITIAL_PLAYBACK,
  type PlaybackController,
  type PlaybackState,
  type PlayerSource,
  type YouTubeMount
} from './recording/playback'
export {
  RecordingHeader,
  recordingActionClass,
  recordingPrimaryActionClass,
  type RecordingHeaderFacts
} from './recording/RecordingHeader'
export { RecordingPlayer } from './recording/RecordingPlayer'

// Settings primitives
export { SettingsCard, SettingsPage } from './components/settings/SettingsCard'
export { SettingsNav, type SettingsNavItem } from './components/settings/SettingsNav'
export {
  ByteCapRow,
  DangerRow,
  LinkRow,
  PathRow,
  SettingsBlock,
  SettingsRow,
  Stat,
  StatRow,
  StatusRow,
  ToggleRow
} from './components/settings/SettingsRow'
export {
  checkboxClass,
  dangerButtonClass,
  fieldLabelClass,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  readonlyInputClass,
  selectClass
} from './components/settings/controls'

// Pages
export { ChampionsPage, type ChampionsPageProps } from './pages/ChampionsPage'
export { DashboardPage, type DashboardPageProps, type MatchFocus } from './pages/DashboardPage'
export { LpEditorPage } from './pages/LpEditorPage'
export { MatchPage } from './pages/MatchPage'
export { RankPage } from './pages/RankPage'
export { RankInput, RankLabel, isApexTier } from './pages/RankInput'
export { ServerDataPage, type ServerDataPageProps } from './admin/ServerData'
export { InvitesPage, type InvitesPageProps } from './admin/Invites'
export { LeagueAccountsPage, type LeagueAccountsPageProps } from './admin/LeagueAccounts'
export { MembersPage, type MembersPageProps } from './admin/Members'
export {
  ServerInsightsPage,
  type InsightsTab,
  type InsightsView,
  type ServerInsightsPageProps
} from './admin/insights/ServerInsights'
export type { LogLevelFilter } from './admin/insights/logs'
export {
  ChangeEmailCard,
  ChangePasswordCard,
  ChangeUsernameCard,
  type AccountSaveResult
} from './account/AccountCards'
export { SeasonsEditor } from './seasons/SeasonsEditor'

// Hooks
export {
  useRecentSummary,
  type ChampionForm,
  type RecentSummary as RecentSummaryFigures
} from './hooks/useRecentSummary'

// Rendering helpers
export {
  championIconUrl,
  championName,
  itemIconUrl,
  profileIconUrl,
  runeIconUrl,
  spellIconUrl
} from './lib/assets'
export { mostPlayed } from './lib/champions'
export { roundedPath, type Point } from './lib/curve'
export { formatBytes, formatMs, formatUptime } from './lib/format'
export { EXAMPLE_RIOT_IDS, randomExampleRiotId } from './lib/exampleRiotId'
export { TRINKET_SLOT, itemSlots } from './lib/items'
export {
  compactNumber,
  damageShare,
  formatAge,
  formatClock,
  formatPercent,
  kdaRatio,
  killParticipation,
  multiKillLabel,
  perMinute
} from './lib/matchStats'
export { positionIcon, positionLabel } from './lib/positions'
export { queueName } from './lib/queues'
export {
  emptyEntry,
  formatTierShort,
  isTier,
  queueLabel,
  rankRecord,
  tierColor,
  tierCrest,
  tierLabel,
  tierProgress,
  type RankRecord,
  type Tier,
  type TierProgress
} from './lib/rank'
export { formatRiotId, parseRiotId } from './lib/riotId'
export { runeIds } from './lib/runes'
