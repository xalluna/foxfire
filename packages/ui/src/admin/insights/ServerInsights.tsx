import type { ReactNode } from 'react'
import {
  INSIGHTS_WINDOWS,
  formatInsightTime,
  type InsightsFrame,
  type InsightsSection,
  type InsightsSections,
  type InsightsWindow
} from '@foxfire/core'
import { SettingsPage } from '../../components/settings/SettingsCard'
import { EmptyState } from '../../components/EmptyState'
import { Segmented } from '../../components/Segmented'
import * as Icon from '../../components/icons'
import { formatUptime } from '../../lib/format'
import { LogsTab, type InsightsLogsProps } from './logs'
import { OverviewTab, RequestsTab, RiotTab, RuntimeTab, SyncTab } from './sections'

export type InsightsTab = InsightsSection | 'logs'

/** One chart tab's figures, told apart by which tab they are for. */
export type InsightsView = { [S in InsightsSection]: { tab: S; data: InsightsSections[S] } }[InsightsSection]

export interface ServerInsightsPageProps {
  tab: InsightsTab
  onTab: (tab: InsightsTab) => void
  window: InsightsWindow
  onWindow: (window: InsightsWindow) => void
  /**
   * The open chart tab's figures. Undefined while they load; null when the
   * server has none to give — one older than insights.
   */
  view: InsightsView | null | undefined
  /** Why the figures could not be read, when they could not. */
  error?: string | null
  logs: InsightsLogsProps & {
    /** True when the server keeps no logs to show — one older than insights. */
    unsupported: boolean
  }
}

const TABS: Array<[InsightsTab, string]> = [
  ['overview', 'Overview'],
  ['requests', 'Requests'],
  ['riot', 'Riot API'],
  ['sync', 'Syncs'],
  ['runtime', 'Runtime'],
  ['logs', 'Logs']
]

/**
 * What the server is doing, and has been doing — for whoever runs it.
 *
 * The same page in the desktop's Settings and the web client's admin tabs, and
 * drawn from the server's own measurements rather than anything the viewing
 * client saw: every request it answered, every call it made to Riot, every sync
 * it ran, and the process underneath. Fifteen minutes is ten-second points,
 * straight out of the server's memory; anything longer is its history, kept
 * for a month.
 */
export function ServerInsightsPage({
  tab,
  onTab,
  window,
  onWindow,
  view,
  error,
  logs
}: ServerInsightsPageProps): JSX.Element {
  const unsupported = tab === 'logs' ? logs.unsupported : view === null

  return (
    <SettingsPage
      title="Server insights"
      intro={
        <>
          What this server has been doing — the requests it answered, what it asked of Riot, the syncs it
          ran, and the process underneath. Measured by the server itself, so it covers everybody on it,
          in the desktop app and in the browser.
        </>
      }
    >
      <div className="space-y-3">
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="w-max">
            <Segmented<InsightsTab> options={TABS} value={tab} onChange={onTab} />
          </div>
        </div>
        {tab !== 'logs' && (
          <div className="-mx-1 flex flex-wrap items-center justify-between gap-2 overflow-x-auto px-1">
            <div className="w-max">
              <Segmented<InsightsWindow>
                size="sm"
                options={INSIGHTS_WINDOWS.map((w) => [w.key, w.key])}
                value={window}
                onChange={onWindow}
              />
            </div>
            {view && <FrameNote frame={view.data.frame} />}
          </div>
        )}
      </div>

      {unsupported ? (
        <EmptyState
          icon={<Icon.Activity width={20} height={20} />}
          title="This server does not report insights"
          description="Insights need Foxfire Server 0.5.0 or newer. Once it is updated, the server starts measuring itself straight away, and the history builds from there."
        />
      ) : error ? (
        <EmptyState
          tone="error"
          icon={<Icon.Warning width={20} height={20} />}
          title="Could not read the server's insights"
          description={error}
        />
      ) : tab === 'logs' ? (
        <LogsTab {...logs} />
      ) : !view || view.tab !== tab ? (
        <Loading />
      ) : (
        <Section view={view} />
      )}
    </SettingsPage>
  )
}

function Section({ view }: { view: InsightsView }): JSX.Element {
  switch (view.tab) {
    case 'overview':
      return <OverviewTab data={view.data} />
    case 'requests':
      return <RequestsTab data={view.data} />
    case 'riot':
      return <RiotTab data={view.data} />
    case 'sync':
      return <SyncTab data={view.data} />
    case 'runtime':
      return <RuntimeTab data={view.data} />
  }
}

/**
 * Where the figures stand: live, and since when. A window reaching back past
 * the history says where the history starts, so an empty left half of every
 * chart is not read as a quiet morning.
 */
function FrameNote({ frame }: { frame: InsightsFrame }): JSX.Element {
  const uptime = formatUptime((frame.now - frame.startedAt) / 1000)
  let note: ReactNode = `up ${uptime}`

  if (frame.historyFrom !== null) {
    note =
      frame.window === '15m'
        ? `since the restart ${uptime} ago`
        : `history from ${formatInsightTime(frame.historyFrom, frame.window === '1h' ? '6h' : frame.window)}`
  }

  return (
    <p className="flex items-center gap-1.5 whitespace-nowrap text-2xs text-text-mute">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden />
      Live · {note}
    </p>
  )
}

function Loading(): JSX.Element {
  return (
    <div className="space-y-3" aria-busy>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-lg border border-hairline bg-surface" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-lg border border-hairline bg-surface" />
      <div className="h-56 animate-pulse rounded-lg border border-hairline bg-surface" />
    </div>
  )
}
