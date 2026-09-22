import type { ReactNode } from 'react'
import type { MatchDetail, MatchSummary } from '@foxfire/core'
import { EmptyState } from '../components/EmptyState'
import { MatchDetailTable } from '../components/MatchDetailTable'
import { MatchListRow } from '../components/MatchListRow'
import { MatchRowSkeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'

/**
 * One game on a page of its own — what a shared link to it opens on.
 *
 * As one player saw it when the link names one: their row from the history,
 * LP and all, above the full scoreboard with their line picked out. Without a
 * player it is just the scoreboard, which is the same for everybody.
 */
export function MatchPage({
  back,
  actions,
  summary,
  summaryLoading,
  detail,
  detailLoading,
  trackedPuuid,
  notFound
}: {
  /** The way back to whoever the link was about — a link, drawn by whoever routes. */
  back?: ReactNode
  /** Beside it — "Copy link". */
  actions?: ReactNode
  /** The player's row. Undefined when the link names nobody this server knows. */
  summary?: MatchSummary | null
  summaryLoading: boolean
  detail: MatchDetail | null | undefined
  detailLoading: boolean
  trackedPuuid: string | null
  /** Nothing on this server by that id at all. */
  notFound: boolean
}): JSX.Element {
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4 max-md:p-2">
      {(back || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">{back}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}

      {notFound ? (
        <EmptyState
          icon={<Icon.Search />}
          title="No game by that id"
          description="This server has no record of it. The link may be from another server, or the game may never have been synced."
        />
      ) : (
        <>
          {summaryLoading ? (
            <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
              <MatchRowSkeleton />
            </section>
          ) : (
            summary && (
              <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
                <MatchListRow match={summary} expanded={false} expandable={false} onToggle={() => {}} />
              </section>
            )
          )}

          <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
            {/* The scoreboard keeps its columns on a phone and scrolls sideways
                on its own, rather than squeezing ten lines of numbers into a
                width they cannot be read at. */}
            <div className="max-md:overflow-x-auto">
              <div className="max-md:min-w-[720px]">
                <MatchDetailTable detail={detail} loading={detailLoading} trackedPuuid={trackedPuuid} />
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
