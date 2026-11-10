import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Asset, ConfirmDialog, EmptyState, Icon, MatchListSkeleton, PlacementBadge, Segmented, ShowMoreButton, checkboxClass, primaryButtonClass, useAssetManifest, championIconUrl, championName, formatAge, formatClock, kdaRatio, placementTone, queueName, tftName } from '@foxfire/ui'
import { DOUBLE_UP_QUEUE_ID, countedPlacement, isTopHalf, strongestTrait, type GameId } from '@foxfire/core'
import { BulkUploadDialog } from '../../media/BulkUploadDialog'
import { describeQueueHold, queueSummary, uploadPending, uploadStatusText } from '../../media/uploadStatus'
import { useUploadQueue, useUploadServer } from '../../media/useMedia'
import { nextOffset, pageItems } from '@foxfire/screens'
import type { Account, BulkUploadResult, Recording } from '@shared/types'
import { canUploadRecording } from '@shared/uploadEligibility'

/** Recordings per page of the list. */
const PAGE_SIZE = 50

/** A sentence on what a batch did, for the line above the list. */
function describeBatch(result: BulkUploadResult): string {
  const queued =
    result.queued === 0
      ? 'Nothing was queued.'
      : `Queued ${result.queued} upload${result.queued === 1 ? '' : 's'} — they go up one at a time, oldest game first.`
  if (result.skipped.length === 0) return queued

  // Grouped by reason: fifty copies of "It is already on the server." say one thing.
  const reasons = new Map<string, number>()
  for (const { reason } of result.skipped) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  const left = [...reasons].map(([reason, n]) => `${n} left out: ${reason}`).join(' ')
  return `${queued} ${left}`
}

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

/** The list's filter: both games, or one. */
type GameFilter = 'all' | GameId

const GAME_FILTERS: Array<[GameFilter, string]> = [
  ['all', 'All'],
  ['lol', 'League'],
  ['tft', 'TFT']
]

export function RecordingsTab({ account }: { account: Account }): JSX.Element {
  const queryClient = useQueryClient()
  const [game, setGame] = useState<GameFilter>('all')
  // The server uploads go to, when this PC is on one that keeps recordings.
  const server = useUploadServer()
  const canUpload = (recording: Recording): boolean => canUploadRecording(recording, server)

  // A page at a time: nothing is ever deleted automatically, so a PC that
  // records every game has a list that only grows. Filtered where the rows
  // are, so a page of TFT is a page of TFT rather than whatever TFT was in a
  // page of both.
  const recordings = useInfiniteQuery({
    queryKey: ['recordings', account.id, 'list', game],
    queryFn: ({ pageParam }) =>
      window.api.recordings.list(account.id, { limit: PAGE_SIZE, offset: pageParam }, game === 'all' ? null : game),
    initialPageParam: 0,
    getNextPageParam: nextOffset
  })

  // Every recording that could go to the server, whole rather than paged —
  // "select all" has to mean all of them, not the ones scrolled to, and the
  // batch dialog reads each one's size. Under the list's key, so whatever
  // refreshes the list refreshes this.
  const uploadable = useQuery({
    queryKey: ['recordings', account.id, 'uploadable', server],
    queryFn: () => window.api.recordings.eligible(account.id),
    enabled: server !== null
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

  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [forgetting, setForgetting] = useState<Recording | null>(null)

  // Recordings picked for a batch upload. Held as ids and read back against
  // the current list, so a row that stopped being eligible — its upload
  // started, its file went — drops out of the selection by itself.
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [batchNote, setBatchNote] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (recordingId: number) => window.api.recordings.remove(recordingId),
    onSuccess: () => {
      setDeleting(null)
      refresh()
    }
  })

  const forget = useMutation({
    mutationFn: (recordingId: number) => window.api.recordings.forget(recordingId),
    onSuccess: () => {
      setForgetting(null)
      refresh()
    }
  })

  const cleanup = useMutation({
    mutationFn: (count: number) => window.api.recordings.removeOldest(account.id, count),
    onSuccess: refresh
  })

  const rows = useMemo(() => pageItems(recordings.data, (recording) => recording.id), [recordings.data])
  const eligible = useMemo(() => uploadable.data ?? [], [uploadable.data])
  const selected = useMemo(() => eligible.filter((recording) => picked.has(recording.id)), [eligible, picked])
  const allPicked = eligible.length > 0 && selected.length === eligible.length

  const toggle = (recordingId: number): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(recordingId)) next.delete(recordingId)
      else next.add(recordingId)
      return next
    })
  }

  const overCap =
    usage.data && usage.data.softCapBytes > 0 && usage.data.totalBytes > usage.data.softCapBytes

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <Segmented options={GAME_FILTERS} value={game} onChange={setGame} size="sm" />
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
            <p className="mt-1 text-xs leading-relaxed text-text-dim">
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
        <p className="mt-4 rounded-md border border-hairline bg-surface/40 px-4 py-2.5 text-xs leading-relaxed text-text-mute">
          {usage.data.missingCount} recording{usage.data.missingCount === 1 ? '' : 's'} can no
          longer be found on disk — moved or deleted outside the app. They are listed below so you
          can clear them out.
        </p>
      )}

      {eligible.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={allPicked}
              onChange={() => setPicked(allPicked ? new Set() : new Set(eligible.map((recording) => recording.id)))}
            />
            Select all {eligible.length} not on the server
          </label>

          <div className="ml-auto flex items-center gap-3">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => setPicked(new Set())}
                className="text-2xs text-text-mute transition hover:text-text"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => setBulkOpen(true)}
              className={primaryButtonClass}
            >
              {selected.length === 0
                ? 'Upload selected'
                : `Upload ${selected.length} to the server`}
            </button>
          </div>
        </div>
      )}

      <QueueBanner />

      {batchNote && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-accent-dim/40 bg-accent/10 px-4 py-2.5 text-xs leading-relaxed text-accent">
          <span className="min-w-0 flex-1">{batchNote}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setBatchNote(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <Icon.Close width={12} height={12} />
          </button>
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-surface/40">
        {recordings.isPending ? (
          <MatchListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Icon.Film />}
            title={game === 'tft' ? 'No TFT recordings yet' : game === 'lol' ? 'No League recordings yet' : 'No recordings yet'}
            description="Turn on game capture in Settings and play a game in one of the queues you enabled. Recording starts once the game finishes loading."
          />
        ) : (
          <>
            <ul className="divide-y divide-hairline/60">
              {rows.map((recording) => (
                <RecordingRow
                  key={recording.id}
                  recording={recording}
                  selectable={eligible.length > 0}
                  selected={picked.has(recording.id) && canUpload(recording)}
                  onToggleSelected={canUpload(recording) ? () => toggle(recording.id) : undefined}
                  onDelete={() => setDeleting(recording)}
                  onForget={() => setForgetting(recording)}
                  canUpload={canUpload(recording)}
                  onUpload={() =>
                    void window.api.media.enqueue([recording.id]).then((result) => {
                      if (result.queued === 0) setBatchNote(describeBatch(result))
                    })
                  }
                />
              ))}
            </ul>
            {recordings.hasNextPage && (
              <ShowMoreButton
                onClick={() => void recordings.fetchNextPage()}
                loading={recordings.isFetchingNextPage}
              />
            )}
          </>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete this recording?"
          message={
            deleting.server
              ? 'The video file on this PC is deleted to free the space. The recording stays, and goes on playing from the server with its markers.'
              : 'The video file and the recording are both deleted from this PC. This cannot be undone.'
          }
          confirmLabel={deleting.server ? 'Delete the file' : 'Delete'}
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {forgetting && (
        <ConfirmDialog
          title="Forget this recording?"
          message={
            forgetting.server
              ? 'It comes off this PC, markers and all. The server keeps its copy, on your history there.'
              : 'It comes off this list. The file is already gone.'
          }
          confirmLabel="Forget"
          danger
          busy={forget.isPending}
          onConfirm={() => forget.mutate(forgetting.id)}
          onCancel={() => setForgetting(null)}
        />
      )}

      {bulkOpen && (
        <BulkUploadDialog
          recordings={selected}
          onClose={() => setBulkOpen(false)}
          onQueued={(result) => {
            setPicked(new Set())
            setBatchNote(describeBatch(result))
            refresh()
          }}
        />
      )}
    </div>
  )
}

function RecordingRow({
  recording,
  selectable,
  selected,
  onToggleSelected,
  onDelete,
  onForget,
  canUpload,
  onUpload
}: {
  recording: Recording
  /** The list is offering a batch upload, so every row keeps a column for the box. */
  selectable: boolean
  selected: boolean
  /** Absent for a row that cannot go to the server, which gets an empty column instead. */
  onToggleSelected?: () => void
  onDelete: () => void
  onForget: () => void
  canUpload: boolean
  onUpload: () => void
}): JSX.Element {
  const assets = useAssetManifest()
  const match = recording.match
  const tft = recording.game === 'tft'
  const board = recording.tftMatch
  const championId = match?.championId ?? recording.selfChampionId
  // A TFT game went well in the top half — the team's top two, in Double Up.
  const wentWell = tft ? (board ? isTopHalf(board, board.queueId) : null) : (match?.win ?? null)
  const onDisk = recording.fileExists
  // A recording on the server still plays after its file has gone — from there.
  const onServer = recording.server !== null
  const playable = onDisk || onServer

  return (
    <li
      className={clsx(
        'flex items-center gap-3 border-l-2 px-4 py-3',
        !playable
          ? 'border-l-hairline bg-surface/30'
          : wentWell === true
            ? 'border-l-teal bg-teal/[0.04]'
            : wentWell === false
              ? 'border-l-red bg-red/[0.04]'
              : 'border-l-hairline'
      )}
    >
      {selectable &&
        (onToggleSelected ? (
          <input
            type="checkbox"
            aria-label="Select for upload"
            className={checkboxClass}
            checked={selected}
            onChange={onToggleSelected}
          />
        ) : (
          <span className="w-4 shrink-0" />
        ))}
      {tft ? (
        <TftBadge recording={recording} />
      ) : (
        <Asset
          src={assets && championId !== null ? championIconUrl(assets, championId) : null}
          className="h-9 w-9"
          rounded="rounded-md"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">
          {tft
            ? tftTitle(assets, recording)
            : assets && championId !== null
              ? championName(assets, championId, match?.championName)
              : (match?.championName ?? 'Recording')}
          <span className="ml-2 text-2xs text-text-mute">
            {match
              ? queueName(match.queueId, match.gameMode)
              : queueName(board?.queueId ?? recording.queueId, tft ? 'TFT' : null)}
          </span>
        </p>
        <p className="mt-0.5 text-2xs text-text-mute">
          {formatAge(recording.startedAt)}
          {' · '}
          {recording.durationSeconds !== null ? formatClock(recording.durationSeconds) : '—'}
          {' · '}
          {recording.fileDeleted ? 'file deleted' : formatBytes(recording.fileBytes)}
        </p>
        <ServerLine recording={recording} />
      </div>

      {board && (
        <span className="w-24 shrink-0 text-sm">
          <PlacementBadge
            placement={countedPlacement(board, board.queueId)}
            top={board.queueId === DOUBLE_UP_QUEUE_ID ? 2 : 4}
          />
          {board.queueId === DOUBLE_UP_QUEUE_ID && board.teamPlacement !== null && (
            <span className="ml-1 text-2xs text-text-mute">team</span>
          )}
        </span>
      )}

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
          onClick={() =>
            void (onDisk ? window.api.recordings.open(recording.id) : window.api.recordings.openServerCopy(recording.id))
          }
          title={playable ? (onDisk ? 'Watch' : 'Watch on the server') : 'The video file is missing'}
          className="rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Watch
        </button>
        {canUpload && (
          <button
            type="button"
            onClick={onUpload}
            title="Upload to the server"
            className="rounded-md border border-edge px-3 py-1.5 text-sm text-text-dim transition hover:border-accent hover:text-accent"
          >
            Upload
          </button>
        )}
        <IconButton
          label="Show in folder"
          disabled={!onDisk}
          onClick={() => void window.api.recordings.reveal(recording.id)}
        >
          <Icon.Folder width={13} height={13} />
        </IconButton>
        {onDisk ? (
          <IconButton label={onServer ? 'Delete the file' : 'Delete recording'} onClick={onDelete} danger>
            <Icon.Trash width={13} height={13} />
          </IconButton>
        ) : (
          <IconButton label="Forget this recording" onClick={onForget} danger>
            <Icon.Close width={13} height={13} />
          </IconButton>
        )}
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
/** A TFT row's name: the trait its board is remembered by, as League's is by its champion. */
function tftTitle(assets: ReturnType<typeof useAssetManifest>, recording: Recording): string {
  const trait = recording.tftMatch ? strongestTrait(recording.tftMatch.traits) : null
  return trait ? tftName(assets, 'traits', trait.name) : 'TFT recording'
}

/** A TFT row's square: the place it finished, in the colour of how that went, or just "TFT" until its game is found. */
function TftBadge({ recording }: { recording: Recording }): JSX.Element {
  const board = recording.tftMatch
  const place = board ? countedPlacement(board, board.queueId) : null
  const tone = place === null ? null : placementTone(place, board?.queueId === DOUBLE_UP_QUEUE_ID ? 2 : 4)

  return (
    <span
      className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-2 font-display tabular-nums',
        place === null ? 'text-2xs text-text-mute' : 'text-base',
        tone === 'first' ? 'text-gold' : tone === 'top' ? 'text-teal' : tone === 'bottom' ? 'text-text-dim' : null
      )}
    >
      {place ?? 'TFT'}
    </span>
  )
}

function BindBadge({ recording }: { recording: Recording }): JSX.Element | null {
  if (!recording.fileExists && !recording.fileDeleted) {
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

/**
 * Where the recording stands with the server, and what can be done about it, in one line.
 *
 * Under the row rather than as more buttons beside it: most rows have nothing
 * going on, and the ones that do need a sentence (why an upload stopped, why
 * the server said no) more than they need another icon.
 */
function ServerLine({ recording }: { recording: Recording }): JSX.Element | null {
  const upload = recording.upload
  const status = uploadStatusText(recording)
  if (!status) return null

  const parts: JSX.Element[] = [
    <span
      key="status"
      className={
        upload?.state === 'failed' ? 'text-red' : upload?.state === 'done' || (!upload && recording.server) ? 'text-teal' : 'text-text-dim'
      }
    >
      {status}
    </span>
  ]

  if (upload?.error && upload.state !== 'uploading' && upload.state !== 'paused') {
    parts.push(
      <span key="why" className="text-text-mute">
        {upload.error}
      </span>
    )
  }

  if (upload?.deleteAfter && uploadPending(upload)) {
    parts.push(
      <span key="after" className="text-text-mute">
        deleted from this PC once it is ready
      </span>
    )
  }

  if (uploadPending(upload) && upload?.state !== 'processing') {
    parts.push(
      <LineButton key="cancel" onClick={() => void window.api.media.cancel(recording.id)}>
        Cancel
      </LineButton>
    )
  } else if ((upload?.state === 'failed' || upload?.state === 'cancelled') && recording.fileExists) {
    parts.push(
      <LineButton key="retry" onClick={() => void window.api.media.retry(recording.id)}>
        Try again
      </LineButton>
    )
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs">
      {parts.map((part, index) => (
        <span key={part.key ?? index} className="inline-flex items-center gap-2">
          {index > 0 && <span className="text-text-mute/50">·</span>}
          {part}
        </span>
      ))}
    </p>
  )
}

/**
 * The queue as a whole, above the list: what is going up, how much is left and
 * how long it will take, with Pause and Resume — the controls a backlog of
 * hundreds of gigabytes needs, which no one row can give.
 */
function QueueBanner(): JSX.Element | null {
  const queue = useUploadQueue()
  if (!queue) return null
  const summary = queueSummary(queue)
  if (!summary && queue.held !== 'paused') return null

  const paused = queue.held === 'paused'
  const why = queue.held && queue.held !== 'paused' ? describeQueueHold(queue.held) : null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-hairline bg-surface/40 px-4 py-2.5 text-xs">
      <Icon.Server width={13} height={13} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-text-dim">
        {summary ?? 'Uploads are paused.'}
        {why && <span className="ml-2 text-text-mute">{why}</span>}
      </span>
      <button
        type="button"
        onClick={() => void (paused ? window.api.media.resumeAll() : window.api.media.pauseAll())}
        className="rounded-md border border-edge px-2.5 py-1 text-text-dim transition hover:border-accent hover:text-accent"
      >
        {paused ? 'Resume uploads' : 'Pause uploads'}
      </button>
    </div>
  )
}

function LineButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="text-accent transition hover:underline">
      {children}
    </button>
  )
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
        'flex h-7 w-7 items-center justify-center rounded-md border border-edge text-text-mute transition disabled:opacity-40',
        danger ? 'hover:border-red/40 hover:text-red' : 'hover:border-accent-dim hover:text-accent'
      )}
    >
      {children}
    </button>
  )
}
