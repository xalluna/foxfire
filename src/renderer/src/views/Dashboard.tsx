import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Account } from '@shared/types'
import { ProfileHeader } from '../components/ProfileHeader'
import { MatchListRow } from '../components/MatchListRow'
import { MatchDetailPanel } from '../components/MatchDetailPanel'
import { SyncProgressBar } from '../components/SyncProgressBar'
import { useUiStore } from '../store/uiStore'

const PAGE_SIZE = 20

export function Dashboard({ account }: { account: Account }): JSX.Element {
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const progress = useUiStore((s) => s.syncProgress[account.id])
  const syncing = progress !== undefined && progress.phase !== 'complete' && progress.phase !== 'error'

  const dashboard = useQuery({
    queryKey: ['dashboard', account.id],
    queryFn: () => window.api.dashboard.get(account.id)
  })

  const matches = useQuery({
    queryKey: ['matchList', account.id, limit],
    queryFn: () => window.api.dashboard.matchList(account.id, limit, 0)
  })

  const sync = useMutation({
    mutationFn: () => window.api.sync.start(account.id)
  })

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <ProfileHeader
        account={dashboard.data?.account ?? account}
        leagueEntries={dashboard.data?.leagueEntries ?? []}
        onRefresh={() => sync.mutate()}
        refreshing={syncing}
      />

      <SyncProgressBar accountId={account.id} />

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <p className="border-b border-slate-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Match history
        </p>

        {matches.isLoading && (
          <p className="px-4 py-6 text-center text-xs text-slate-500">Loading matches…</p>
        )}

        {matches.data?.length === 0 && !matches.isLoading && (
          <p className="px-4 py-6 text-center text-xs text-slate-500">
            No matches stored yet. {syncing ? 'Sync in progress…' : 'Try “Sync now”.'}
          </p>
        )}

        <ul className="divide-y divide-slate-800/70">
          {matches.data?.map((match) => (
            <li key={match.matchId}>
              <MatchListRow
                match={match}
                expanded={expandedMatchId === match.matchId}
                onToggle={() =>
                  setExpandedMatchId(expandedMatchId === match.matchId ? null : match.matchId)
                }
              />
              {expandedMatchId === match.matchId && (
                <MatchDetailPanel matchId={match.matchId} trackedPuuid={account.puuid} />
              )}
            </li>
          ))}
        </ul>

        {matches.data && matches.data.length >= limit && (
          <button
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            className="w-full border-t border-slate-800 py-2.5 text-xs text-slate-400 transition hover:bg-slate-800/40 hover:text-slate-200"
          >
            Show more
          </button>
        )}
      </section>
    </div>
  )
}
