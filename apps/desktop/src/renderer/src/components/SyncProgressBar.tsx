import { useUiStore } from '../store/uiStore'
import { Bar } from './Bar'
import * as Icon from './icons'

export function SyncProgressBar({ accountId }: { accountId: string }): JSX.Element | null {
  const progress = useUiStore((s) => s.syncProgress[accountId])
  if (!progress || progress.phase === 'complete') return null

  // Automatic syncs stay out of sight — a post-game refresh retries until Riot
  // publishes the match, and showing that would flash the bar several times for
  // work the user never asked for. A backfill is the exception: it runs for
  // minutes, and hiding one would read as the app having frozen.
  if (progress.trigger === 'auto' && progress.phase !== 'backfill') return null

  if (progress.phase === 'error') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-red/40 bg-red/10 px-2.5 py-2 text-2xs leading-snug text-red">
        <Icon.Warning width={13} height={13} className="mt-px shrink-0" />
        <span>Sync failed: {progress.message ?? 'unknown error'}</span>
      </div>
    )
  }

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const label = progress.phase === 'backfill' ? 'Backfilling history' : 'Syncing new matches'
  // Riot's 100-req/2min ceiling works out to roughly 1.2s per match detail.
  const minutesLeft = Math.max(1, Math.round(((progress.total - progress.current) * 1.2) / 60))

  return (
    <div className="mt-3 rounded-md border border-hairline bg-canvas px-2.5 py-2">
      <div className="flex items-center justify-between text-2xs">
        <span className="text-text-dim">{label}</span>
        <span className="tabular-nums text-text-mute">
          {progress.total > 0 ? `${progress.current} / ${progress.total}` : ''}
        </span>
      </div>
      <Bar fraction={pct / 100} tone="accent-solid" className="mt-1.5" />
      {progress.phase === 'backfill' && progress.total > 25 && (
        <p className="mt-1.5 text-[10px] leading-snug text-text-mute">
          About {minutesLeft} min left at the personal-key rate limit. You can keep using the app
          while it runs.
        </p>
      )}
    </div>
  )
}
