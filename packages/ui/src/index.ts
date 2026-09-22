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
export {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuState
} from './components/ContextMenu'
export { CopyLinkButton } from './components/CopyLinkButton'
export { Disclaimer } from './components/Disclaimer'
export { EmptyState } from './components/EmptyState'
export { ErrorBoundary } from './components/ErrorBoundary'
export { ItemStrip } from './components/ItemStrip'
export { Logo } from './components/Logo'
export { LpChip } from './components/LpChip'
export { MatchDetailTable } from './components/MatchDetailTable'
export { MatchListRow } from './components/MatchListRow'
export { ProfileHeader } from './components/ProfileHeader'
export { ProfileStrip } from './components/ProfileStrip'
export { QueueFilter } from './components/QueueFilter'
export { RankCard } from './components/RankCard'
export { RankChart } from './components/RankChart'
export { RecentSummary } from './components/RecentSummary'
export { Segmented } from './components/Segmented'
export { MatchListSkeleton, MatchRowSkeleton, Skeleton } from './components/Skeleton'
export { SyncProgressBar } from './components/SyncProgressBar'
export * as Icon from './components/icons'

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
export { SearchPage } from './pages/SearchPage'
export { RankInput, RankLabel, isApexTier } from './pages/RankInput'
export { ServerDataPage, type ServerDataPageProps } from './admin/ServerData'
export { ServerManagementPage, type ServerManagementPageProps } from './admin/ServerManagement'
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
export { roundedPath, type Point } from './lib/curve'
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
  type RankRecord,
  type Tier
} from './lib/rank'
export { formatRiotId, parseRiotId } from './lib/riotId'
export { runeIds } from './lib/runes'
