import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Asset } from '../../components/Asset'
import { EmptyState } from '../../components/EmptyState'
import * as Icon from '../../components/icons'
import { MatchListSkeleton } from '../../components/Skeleton'
import { useAssets } from '../../hooks/useAssets'
import { championIconUrl, championName } from '../../lib/assets'
import { formatAge, formatClock, kdaRatio } from '../../lib/matchStats'
import { queueName } from '../../lib/queues'
import type { Account, Recording } from '@shared/types'

/**
 * Every recording, bound to a match or not.
 *
 * The right-click on a match row is the main way into a recording, but it can
 * only ever reach recordings that found their match. A Practice Tool game
 * produces no match-v5 entry and never will, and a sync that never landed
 * leaves one stranded — without this tab that footage would exist on disk and
 * be unreachable from inside the app.
 *
 * It is also where the disk actually gets managed: nothing is ever deleted
 * automatically, so there has to be somewhere to see the total and do something
 * about it.
 */
const GB = 1024 * 1024 * 1024

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '—'
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

export function RecordingsTab({ account }: { account: Account }): JSX.Element {
  const queryClient = useQueryClient()

  const recordings = useQuery({
    queryKey: ['recordings', account.id],
    queryFn: () => window.api.recordings.list(account.id)
  })

  const usage = useQuery({
    queryKey: ['recordingUsage'],
    queryFn: () => window.api.recordings.usage()
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['recordings', account.id] })
    void queryClient.invalidateQueries({ queryKey: ['recordingUsage'] })
    void queryClient.invalidateQueries({ queryKey: ['matchList', account.id] })
  }

  const remove = useMutation({
    mutationFn: (recordingId: number) => window.api.recordings.remove(recordingId),
    onSuccess: refresh
  })

  const cleanup = useMutation({
    mutationFn: (count: number) => window.api.recordings.removeOldest(account.id, count),
    onSuccess: refresh
  })

  const rows = recordings.data ?? []
  const overCap =
    usage.data && usage.data.softCapBytes > 0 && usage.data.totalBytes > usage.data.softCapBytes

  return (
    <div>
      <div className="flex items-baseline justify-end gap-4">
        {usage.data && usage.data.count > 0 && (
          <p className="text-sm tabular-nums text-text-dim">
            {formatBytes(usage.data.totalBytes)} across {usage.data.count}{' '}
            {usage.data.count === 1 ? 'recording' : 'recordings'}
          </p>
        )}
      </div>

      {overCap && usage.data && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/10 p-4">
          <Icon.Warning className="mt-0.5 shrink-0 text-amber" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-amber">
              Recordings are past the {Math.round(usage.data.softCapBytes / GB)} GB you asked to be
              warned at.
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-text-dim">
              Nothing has been deleted — this is a reminder, not a limit. Raise the number in
              Settings, or clear out the oldest games.
            </p>
            <button
              type="button"
              disabled={cleanup.isPending}
              onClick={() => cleanup.mutate(5)}
              className="mt-3 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-sm font-medium text-amber transition hover:bg-amber/20 disabled:opacity-50"
            >
              Delete the 5 oldest
            </button>
          </div>
        </div>
      )}

      {usage.data && usage.data.missingCount > 0 && (
        <p className="mt-4 rounded-md border border-hairline bg-surface/40 px-4 py-2.5 text-2xs leading-relaxed text-text-mute">
          {usage.data.missingCount} recording{usage.data.missingCount === 1 ? '' : 's'} can no
          longer be found on disk — moved or deleted outside the app. They are listed below so you
          can clear them out.
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-surface/40">
        {recordings.isPending ? (
          <MatchListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Icon.Film />}
            title="No recordings yet"
            description="Turn on game capture in Settings and play a game in one of the queues you enabled. Recording starts once the game finishes loading."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {rows.map((recording) => (
              <RecordingRow
                key={recording.id}
                recording={recording}
                onDelete={() => remove.mutate(recording.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RecordingRow({
  recording,
  onDelete
}: {
  recording: Recording
  onDelete: () => void
}): JSX.Element {
  const assets = useAssets()
  const match = recording.match
  const championId = match?.championId ?? recording.selfChampionId
  const playable = recording.fileExists

  return (
    <li
      className={clsx(
        'flex items-center gap-3 border-l-2 px-4 py-3',
        !playable
          ? 'border-l-hairline bg-surface/30'
          : match?.win === true
            ? 'border-l-teal bg-teal/[0.04]'
            : match?.win === false
              ? 'border-l-red bg-red/[0.04]'
              : 'border-l-hairline'
      )}
    >
      <Asset
        src={assets && championId !== null ? championIconUrl(assets, championId) : null}
        className="h-9 w-9"
        rounded="rounded-md"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">
          {assets && championId !== null
            ? championName(assets, championId, match?.championName)
            : (match?.championName ?? 'Recording')}
          <span className="ml-2 text-2xs text-text-mute">
            {match ? queueName(match.queueId, match.gameMode) : queueName(recording.queueId, null)}
          </span>
        </p>
        <p className="mt-0.5 text-2xs text-text-mute">
          {formatAge(recording.startedAt)}
          {' · '}
          {recording.durationSeconds !== null ? formatClock(recording.durationSeconds) : '—'}
          {' · '}
          {formatBytes(recording.fileBytes)}
        </p>
      </div>

      {match && (
        <span className="w-24 shrink-0 text-sm tabular-nums text-text-dim">
          {match.kills} / <span className="text-red">{match.deaths}</span> / {match.assists}
          <span className="ml-1 text-2xs text-text-mute">
            {kdaRatio(match.kills, match.deaths, match.assists)}
          </span>
        </span>
      )}

      <BindBadge recording={recording} />

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={!playable}
          onClick={() => void window.api.recordings.open(recording.id)}
          title={playable ? 'Watch' : 'The video file is missing'}
          className="rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Watch
        </button>
        <IconButton
          label="Show in folder"
          disabled={!playable}
          onClick={() => void window.api.recordings.reveal(recording.id)}
        >
          <Icon.Folder width={13} height={13} />
        </IconButton>
        <IconButton label="Delete recording" onClick={onDelete} danger>
          <Icon.Trash width={13} height={13} />
        </IconButton>
      </div>
    </li>
  )
}

/**
 * Whether the recording found its game.
 *
 * 'unmatched' is stated plainly rather than hidden: it is the expected outcome
 * for a Practice Tool game, and a user who sees it on a ranked game learns
 * something real about their sync.
 */
function BindBadge({ recording }: { recording: Recording }): JSX.Element | null {
  if (!recording.fileExists) {
    return <Badge tone="warning">File missing</Badge>
  }
  if (recording.bindState === 'pending') {
    return <Badge tone="neutral">Matching…</Badge>
  }
  if (recording.bindState === 'unmatched') {
    return <Badge tone="neutral">No match entry</Badge>
  }
  return null
}

function Badge({
  tone,
  children
}: {
  tone: 'neutral' | 'warning'
  children: React.ReactNode
}): JSX.Element {
  return (
    <span
      className={clsx(
        'shrink-0 rounded border px-2 py-0.5 text-2xs',
        tone === 'warning'
          ? 'border-amber/30 bg-amber/10 text-amber'
          : 'border-hairline bg-canvas text-text-mute'
      )}
    >
      {children}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-text-mute transition disabled:opacity-40',
        danger ? 'hover:border-red/40 hover:text-red' : 'hover:border-accent-dim hover:text-accent'
      )}
    >
      {children}
    </button>
  )
}
