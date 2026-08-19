import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Asset } from '../components/Asset'
import { EmptyState } from '../components/EmptyState'
import * as Icon from '../components/icons'
import { MatchListSkeleton } from '../components/Skeleton'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName } from '../lib/assets'
import { formatAge, formatClock, kdaRatio } from '../lib/matchStats'
import { queueName } from '../lib/queues'
import { ReplayPlayer } from './ReplayPlayer'
import type { Replay } from '@shared/types'

/**
 * A window that owns one replay.
 *
 * Several can be open at once — the same game at two timestamps on two
 * monitors is a real way to compare a botched fight against how it should have
 * gone — so unlike the telemetry panel and the LP editor this is not a
 * singleton on the main side. See replayWindow.ts.
 *
 * Loads the same renderer bundle as everything else, selected by the URL hash.
 */
function replayIdFromHash(): number | null {
  const query = window.location.hash.split('?')[1] ?? ''
  const id = Number(new URLSearchParams(query).get('id'))
  return Number.isInteger(id) && id > 0 ? id : null
}

export function ReplayApp(): JSX.Element {
  const replayId = replayIdFromHash()

  const detail = useQuery({
    queryKey: ['replayDetail', replayId],
    queryFn: () => window.api.replays.detail(replayId!),
    enabled: replayId !== null,
    // The recording never changes once it has stopped, so there is nothing to
    // refetch and a window left open overnight costs nothing.
    staleTime: Infinity
  })

  if (replayId === null) {
    return (
      <Shell>
        <EmptyState
          icon={<Icon.Warning />}
          title="No replay was named"
          description="This window was opened without a replay to show."
          tone="error"
        />
      </Shell>
    )
  }

  if (detail.isPending) {
    return (
      <Shell>
        <div className="p-6">
          <MatchListSkeleton rows={3} />
        </div>
      </Shell>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <Shell>
        <EmptyState
          icon={<Icon.Warning />}
          title="That replay is gone"
          description="It was deleted, or the database no longer knows about it."
          tone="error"
        />
      </Shell>
    )
  }

  const { replay, events } = detail.data

  return (
    <Shell>
      <ReplayHeader replay={replay} />
      {replay.fileExists ? (
        <ReplayPlayer src={`replay://media/${replay.id}`} events={events} />
      ) : (
        <EmptyState
          icon={<Icon.Film />}
          title="The video file is missing"
          description="The recording is no longer where it was written. It may have been moved or deleted outside the app."
          tone="warning"
        />
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex h-screen flex-col bg-canvas text-text">{children}</div>
}

/**
 * Champion, KDA, result and a way back to the match.
 *
 * The link is why a replay is not a dead end: the video shows what happened and
 * the match row shows the numbers, and reading one against the other is most of
 * the value. It focuses the main window rather than duplicating the detail
 * panel here, which would be a second copy of a component built for a 320px
 * column inside a window shaped for video.
 */
function ReplayHeader({ replay }: { replay: Replay }): JSX.Element {
  const assets = useAssets()
  const match = replay.match
  const championId = match?.championId ?? replay.selfChampionId

  return (
    <header className="flex items-center gap-3 border-b border-hairline bg-surface px-4 py-2.5">
      <Asset
        src={assets && championId !== null ? championIconUrl(assets, championId) : null}
        className="h-9 w-9"
        rounded="rounded-md"
      />

      <div className="min-w-0">
        <p className="truncate font-display text-base text-text">
          {assets && championId !== null
            ? championName(assets, championId, match?.championName)
            : (match?.championName ?? 'Recording')}
        </p>
        <p className="text-2xs text-text-mute">
          {match ? queueName(match.queueId, match.gameMode) : queueName(replay.queueId, null)}
          {' · '}
          {replay.durationSeconds !== null ? formatClock(replay.durationSeconds) : '—'}
          {' · '}
          {formatAge(replay.startedAt)}
        </p>
      </div>

      {match && (
        <>
          <span
            className={clsx(
              'ml-2 rounded border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide',
              match.win ? 'border-teal/30 bg-teal/10 text-teal' : 'border-red/30 bg-red/10 text-red'
            )}
          >
            {match.win ? 'Victory' : 'Defeat'}
          </span>
          <span className="text-sm tabular-nums text-text-dim">
            {match.kills} / <span className="text-red">{match.deaths}</span> / {match.assists}
            <span className="ml-1.5 text-text-mute">
              {kdaRatio(match.kills, match.deaths, match.assists)} KDA
            </span>
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {replay.bindState === 'pending' && (
          <span className="text-2xs text-text-mute">Still looking for this game…</span>
        )}
        {replay.bindState === 'unmatched' && (
          <span className="text-2xs text-text-mute">No match history entry</span>
        )}
        {match && (
          <button
            type="button"
            onClick={() => void window.api.replays.showMatch(replay.accountId, match.matchId)}
            className="rounded-md border border-gold-dim bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold transition hover:bg-gold/20"
          >
            View match history
          </button>
        )}
      </div>
    </header>
  )
}
