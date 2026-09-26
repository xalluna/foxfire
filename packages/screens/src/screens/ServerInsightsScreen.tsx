import { useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  DEFAULT_INSIGHTS_WINDOW,
  insightsPollMs,
  type InsightsSection,
  type InsightsWindow,
  type Page,
  type ServerLogEntry
} from '@foxfire/core'
import { ServerInsightsPage, type InsightsTab, type InsightsView, type LogLevelFilter } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems, pageTotal } from '../queries/paging'

/** Log lines per page. */
const LOG_PAGE_SIZE = 50

/** How often the first page of the logs is asked again while it is the only one open. */
const LOG_POLL_MS = 10_000

/** Where the next page of logs starts, and the line the first page began at. */
interface LogPageParam {
  offset: number
  before?: number
}

/**
 * What the server is doing, and has been doing.
 *
 * Polled rather than pushed: an open tab asks again as often as its window's
 * newest point can change — every five seconds for fifteen minutes, every
 * minute for a month — and not at all while the window is hidden, which is
 * React Query's default. The events that refresh everything else never touch
 * it; nothing a member does makes these figures stale faster than the clock.
 */
export function ServerInsightsScreen(): JSX.Element {
  const client = useClient()

  const [tab, setTab] = useState<InsightsTab>('overview')
  const [window, setWindow] = useState<InsightsWindow>(DEFAULT_INSIGHTS_WINDOW)
  const [level, setLevel] = useState<LogLevelFilter>('warning')

  // The logs have no chart; while they are open the section query sleeps, and
  // its key is only a placeholder.
  const section: InsightsSection = tab === 'logs' ? 'overview' : tab

  const figures = useQuery({
    queryKey: queryKeys.admin.insights(section, window),
    queryFn: async (): Promise<InsightsView | null> => {
      const data = await client.admin.insights(section, window)
      return data === null ? null : ({ tab: section, data } as InsightsView)
    },
    enabled: tab !== 'logs',
    refetchInterval: insightsPollMs(window),
    // A new window holds the last one's charts up until it arrives, rather
    // than blanking the page on every click of the picker.
    placeholderData: keepPreviousData
  })

  const logs = useInfiniteQuery({
    queryKey: queryKeys.admin.serverLogs(level),
    queryFn: ({ pageParam }) =>
      client.admin.serverLogs({
        level,
        limit: LOG_PAGE_SIZE,
        offset: pageParam.offset,
        before: pageParam.before
      }),
    initialPageParam: { offset: 0 } as LogPageParam,
    getNextPageParam: (last, all): LogPageParam | undefined => {
      if (last === null) return undefined

      const pages = all.filter((page): page is Page<ServerLogEntry> => page !== null)
      const offset = nextOffset(last, pages)
      if (offset === undefined) return undefined

      // Every later page is pinned to where the first began, so lines written
      // since do not push the ones already shown onto the next page too.
      const newest = pages[0]?.items[0]?.seq
      return { offset, before: newest === undefined ? undefined : newest + 1 }
    },
    enabled: tab === 'logs',
    // Only while one page is open. Asking again for pages pinned to an older
    // first page would leave a gap between the new first page and them.
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) > 1 ? false : LOG_POLL_MS)
  })

  const logPages = logs.data
    ? { pages: logs.data.pages.filter((p): p is Page<ServerLogEntry> => p !== null), pageParams: logs.data.pageParams }
    : undefined

  const error =
    figures.isError && figures.data === undefined
      ? figures.error instanceof Error
        ? figures.error.message
        : String(figures.error)
      : null

  return (
    <ServerInsightsPage
      tab={tab}
      onTab={setTab}
      window={window}
      onWindow={setWindow}
      view={figures.data}
      error={tab === 'logs' ? (logs.isError ? String(logs.error) : null) : error}
      logs={{
        entries: logs.data ? pageItems(logPages, (entry) => entry.seq) : undefined,
        total: pageTotal(logPages),
        level,
        onLevel: setLevel,
        hasMore: logs.hasNextPage,
        loadingMore: logs.isFetchingNextPage,
        onShowMore: () => void logs.fetchNextPage(),
        unsupported: logs.data?.pages[0] === null
      }}
    />
  )
}
