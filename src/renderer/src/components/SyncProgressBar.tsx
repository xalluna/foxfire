import { useUiStore } from '../store/uiStore'

export function SyncProgressBar({ accountId }: { accountId: number }): JSX.Element | null {
  const progress = useUiStore((s) => s.syncProgress[accountId])
  if (!progress || progress.phase === 'complete') return null

  if (progress.phase === 'error') {
    return (
      <div className="rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
        Sync failed: {progress.message ?? 'unknown error'}
      </div>
    )
  }

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const label = progress.phase === 'backfill' ? 'Backfilling match history' : 'Syncing new matches'
  // Riot's 100-req/2min ceiling works out to roughly 1.2s per match detail.
  const minutesLeft = Math.max(1, Math.round(((progress.total - progress.current) * 1.2) / 60))

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>
          {label}
          {progress.message ? ` — ${progress.message}` : ''}
        </span>
        <span className="tabular-nums text-slate-400">
          {progress.total > 0 ? `${progress.current} / ${progress.total}` : ''}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.phase === 'backfill' && progress.total > 25 && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          {progress.total} games available from Riot — about {minutesLeft} min left at the
          personal-key rate limit. You can keep using the app while it runs.
        </p>
      )}
    </div>
  )
}
