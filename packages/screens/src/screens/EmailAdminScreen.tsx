import { useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult, EmailLogEntry, EmailSuppression, Page } from '@foxfire/core'
import { EmailAdminPage, type EmailLogFilters } from '@foxfire/ui'
import { useClient } from '../client/context'
import { useConnection } from '../client/useConnection'
import { useDebounced } from '../hooks/useDebounced'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems, pageTotal } from '../queries/paging'

/** Log lines, and suppressions, per page. */
const PAGE_SIZE = 50

/** How often the quota and the queue are asked again while the page is open. */
const OVERVIEW_POLL_MS = 10_000

/**
 * The server's mail, for its head admins: the allowance, what is waiting, every
 * message and what became of it, and the addresses mail no longer goes to.
 *
 * The overview is polled — a held message going out at midnight, a bounce
 * arriving by webhook, are nothing any event here would say. The log and the
 * suppressions are paged, as every list that grows is.
 */
export function EmailAdminScreen(): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const connection = useConnection()

  const [filters, setFilters] = useState<EmailLogFilters>({ kind: '', status: '', q: '' })
  const q = useDebounced(filters.q.trim())
  const query = { kind: filters.kind || undefined, status: filters.status || undefined, q }

  const overview = useQuery({
    queryKey: queryKeys.admin.emailOverview(),
    queryFn: () => client.admin.emailOverview(),
    refetchInterval: OVERVIEW_POLL_MS
  })

  const log = useInfiniteQuery({
    queryKey: queryKeys.admin.emailLog(query),
    queryFn: ({ pageParam }) => client.admin.emailLog({ ...query, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last === null ? undefined : nextOffset(last, all.filter((p): p is Page<EmailLogEntry> => p !== null)),
    refetchInterval: OVERVIEW_POLL_MS,
    placeholderData: keepPreviousData
  })

  const suppressions = useInfiniteQuery({
    queryKey: queryKeys.admin.emailSuppressions(''),
    queryFn: ({ pageParam }) => client.admin.emailSuppressions({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last === null
        ? undefined
        : nextOffset(last, all.filter((p): p is Page<EmailSuppression> => p !== null))
  })

  const logPages = log.data
    ? { pages: log.data.pages.filter((p): p is Page<EmailLogEntry> => p !== null), pageParams: log.data.pageParams }
    : undefined

  const suppressionPages = suppressions.data
    ? {
        pages: suppressions.data.pages.filter((p): p is Page<EmailSuppression> => p !== null),
        pageParams: suppressions.data.pageParams
      }
    : undefined

  const thenRefresh = async (run: Promise<AdminActionResult>): Promise<AdminActionResult> => {
    try {
      return await run
    } finally {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.email() })
      // Clearing a suppression can make an invite emailable again.
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.invites() })
    }
  }

  const overviewError =
    overview.isError && overview.data === undefined
      ? overview.error instanceof Error
        ? overview.error.message
        : String(overview.error)
      : null

  return (
    <EmailAdminPage
      overview={overview.data}
      overviewError={overviewError}
      log={logPages ? pageItems(logPages, (entry) => entry.id) : undefined}
      logTotal={logPages ? pageTotal(logPages) : undefined}
      filters={filters}
      onFilters={setFilters}
      hasMoreLog={log.hasNextPage}
      loadingMoreLog={log.isFetchingNextPage}
      onShowMoreLog={() => void log.fetchNextPage()}
      suppressions={suppressionPages ? pageItems(suppressionPages, (s) => s.id) : undefined}
      suppressionsTotal={suppressionPages ? pageTotal(suppressionPages) : undefined}
      hasMoreSuppressions={suppressions.hasNextPage}
      loadingMoreSuppressions={suppressions.isFetchingNextPage}
      onShowMoreSuppressions={() => void suppressions.fetchNextPage()}
      onClearSuppression={(id) => thenRefresh(client.admin.clearEmailSuppression(id))}
      onSendTest={(to) => thenRefresh(client.admin.sendTestEmail(to))}
      defaultTestAddress={connection?.session?.email}
    />
  )
}
