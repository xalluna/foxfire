import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Asset } from '../components/Asset'
import { useAssetManifest } from '../context/assetManifest'
import { championIconUrl, championName } from '../lib/assets'
import { formatAge, formatClock, kdaRatio } from '../lib/matchStats'
import { queueName } from '../lib/queues'

/** What the strip above a recording says about the game. Null wherever the game did not say. */
export interface RecordingHeaderFacts {
  championId: number | null
  championName: string | null
  queueId: number | null
  gameMode: string | null
  durationSeconds: number | null
  /** Epoch milliseconds. */
  playedAt: number | null
  /** Null for a recording that never found its match. */
  win: boolean | null
  kills: number | null
  deaths: number | null
  assists: number | null
}

/**
 * Champion, KDA, result, and whatever can be done from here.
 *
 * The same strip over the desktop's own recording window and the web's
 * recording page, so a recording reads the same wherever it is opened. What
 * each can do differs — upload, attach a link, jump back to the history — so
 * the buttons are the caller's, in `actions`.
 */
export function RecordingHeader({
  facts,
  status,
  actions
}: {
  facts: RecordingHeaderFacts
  /** A quiet note beside the buttons: "Still looking for this game…", "Uploading 42%". */
  status?: ReactNode
  actions?: ReactNode
}): JSX.Element {
  const assets = useAssetManifest()
  const { championId } = facts

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-hairline bg-surface px-4 py-2.5">
      <Asset
        src={assets && championId !== null ? championIconUrl(assets, championId) : null}
        className="h-9 w-9"
        rounded="rounded-md"
      />

      <div className="min-w-0">
        <p className="truncate font-display text-base text-text">
          {assets && championId !== null
            ? championName(assets, championId, facts.championName)
            : (facts.championName ?? 'Recording')}
        </p>
        <p className="text-2xs text-text-mute">
          {queueName(facts.queueId, facts.gameMode)}
          {' · '}
          {facts.durationSeconds !== null ? formatClock(Math.round(facts.durationSeconds)) : '—'}
          {facts.playedAt !== null && (
            <>
              {' · '}
              {formatAge(facts.playedAt)}
            </>
          )}
        </p>
      </div>

      {facts.win !== null && (
        <span
          className={clsx(
            'ml-2 rounded border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide',
            facts.win ? 'border-teal/30 bg-teal/10 text-teal' : 'border-red/30 bg-red/10 text-red'
          )}
        >
          {facts.win ? 'Victory' : 'Defeat'}
        </span>
      )}

      {facts.kills !== null && facts.deaths !== null && facts.assists !== null && (
        <span className="text-sm tabular-nums text-text-dim">
          {facts.kills} / <span className="text-red">{facts.deaths}</span> / {facts.assists}
          <span className="ml-1.5 text-text-mute">
            {kdaRatio(facts.kills, facts.deaths, facts.assists)} KDA
          </span>
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {status && <span className="text-2xs text-text-mute">{status}</span>}
        {actions}
      </div>
    </header>
  )
}

/** The button style the header's actions share. */
export const recordingActionClass =
  'rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-40'

export const recordingPrimaryActionClass =
  'rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20'
