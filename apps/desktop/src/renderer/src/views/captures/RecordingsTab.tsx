import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Asset, ConfirmDialog, EmptyState, Icon, MatchListSkeleton, PlacementBadge, Segmented, ShowMoreButton, checkboxClass, dangerButtonClass, primaryButtonClass, selectClass, useAssetManifest, championIconUrl, championName, formatAge, formatClock, kdaRatio, placementTone, queueName, tftName } from '@foxfire/ui'
import { DOUBLE_UP_QUEUE_ID, countedPlacement, isTopHalf, strongestTrait, type Account, type GameId } from '@foxfire/core'
import { BulkUploadDialog } from '../../media/BulkUploadDialog'
import { describeQueueHold, queueSummary, uploadPending, uploadStatusText } from '../../media/uploadStatus'
import { useUploadQueue, useUploadServer } from '../../media/useMedia'
import { nextOffset, pageItems, queryKeys, useMyAccounts } from '@foxfire/screens'
import type { BulkUploadResult, ForgetResult, Recording, RecordingFilter } from '@shared/types'
import { canUploadRecording, isSomebodyElsesUpload } from '@shared/uploadEligibility'

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

/** A sentence on what forgetting did, for the same line. */
function describeForget(result: ForgetResult): string {
  const forgot =
    result.forgotten === 0
      ? 'Nothing was forgotten.'
      : `Forgot ${result.forgotten} recording${result.forgotten === 1 ? '' : 's'}.`
  if (result.kept === 0) return forgot
  return `${forgot} ${result.kept} ${result.kept === 1 ? 'was' : 'were'} kept, because ${result.kept === 1 ? 'its file' : 'their files'} could not be deleted — close anything playing ${result.kept === 1 ? 'it' : 'them'} and try again.`
}

/** "1 recording", "3 recordings". */
function recordings(n: number): string {
  return `${n} recording${n === 1 ? '' : 's'}`
}

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

/**
 * The player a recording was made on: the row's own Riot ID, or failing that
 * one of your accounts by its id — a recording written while the server could
 * not be reached knows only the server's id for it.
 */
function playerOf(recording: Recording, mine: readonly Account[]): string | null {
  if (recording.riotId) return recording.riotId
  const account = mine.find((candidate) => candidate.id === recording.accountId)
  return account ? `${account.gameName}#${account.tagLine}` : null
}

/** Whether a recording is in the list as filtered — the same test main applies to the rows. */
function inFilter(recording: Recording, filter: RecordingFilter): boolean {
  if (filter.game && recording.game !== filter.game) return false
  if (filter.player && recording.riotId?.toLowerCase() !== filter.player.toLowerCase()) return false
  return true
}

/**
 * Every recording on this PC, bound to a match or not, whoever played it.
 *
 * The right-click on a match row is the main way into a recording, but it can
 * only ever reach recordings that found their match. A Practice Tool game
 * produces no match-v5 entry and never will, and a sync that never landed
 * leaves one stranded — without this tab that footage would exist on disk and
 * be unreachable from inside the app.
 *
 * It is also where the disk actually gets managed: nothing is ever deleted
 * automatically, so there has to be somewhere to see the total and do something
 * about it. Which is why it is not one account's: the files are on this disk
 * whichever account is picked in the rail, and a list of one account's under a
 * total of everybody's warned about files it gave no way to reach.
 */
export function RecordingsTab(): JSX.Element {
  const queryClient = useQueryClient()
  const [game, setGame] = useState<GameFilter>('all')
  const [player, setPlayer] = useState<string | null>(null)
  // The server uploads go to, when this PC is on one that keeps recordings,
  // and the accounts that are yours there — the only ones it takes an upload for.
  const server = useUploadServer()
  const mine = useMyAccounts().data ?? []
  const canUpload = (recording: Recording): boolean => canUploadRecording(recording, server, mine)

  const filter: RecordingFilter = { game: game === 'all' ? null : game, player }

  // A page at a time: nothing is ever deleted automatically, so a PC that
  // records every game has a list that only grows. Filtered where the rows
  // are, so a page of TFT is a page of TFT rather than whatever TFT was in a
  // page of both.
  const list = useInfiniteQuery({
    queryKey: ['recordings', 'list', filter],
    queryFn: ({ pageParam }) => window.api.recordings.list({ limit: PAGE_SIZE, offset: pageParam }, filter),
    initialPageParam: 0,
    getNextPageParam: nextOffset
  })

  const players = useQuery({
    queryKey: ['recordings', 'players'],
    queryFn: () => window.api.recordings.players()
  })

  // Every recording you could send to the server, whole rather than paged —
  // "select all" has to mean all of them, not the ones scrolled to, and the
  // batch dialog reads each one's size. Under the list's key, so whatever
  // refreshes the list refreshes this.
  const uploadable = useQuery({
    queryKey: ['recordings', 'uploadable', server],
    queryFn: () => window.api.recordings.eligible(),
    enabled: server !== null
  })

  const usage = useQuery({
    queryKey: ['recordingUsage'],
    queryFn: () => window.api.recordings.usage()
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['recordings'] })
    void queryClient.invalidateQueries({ queryKey: ['recordingUsage'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.matchLists() })
  }

  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [forgetting, setForgetting] = useState<Recording | null>(null)
  const [forgettingPicked, setForgettingPicked] = useState(false)
  const [forgettingServerOnly, setForgettingServerOnly] = useState(false)

  // One selection, for whatever is done to many rows at once: uploading them
  // or forgetting them. Held as ids and read back against what is loaded, so
  // a row that went — forgotten, deleted — drops out of it by itself, and
  // each action takes the rows it applies to: Upload the ones that can go,
  // Forget all of them.
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // A different filter is a different list; a selection made in the last one
  // would act on rows this one does not show.
  const chooseGame = (next: GameFilter): void => {
    setGame(next)
    setPicked(new Set())
  }
  const choosePlayer = (next: string | null): void => {
    setPlayer(next)
    setPicked(new Set())
  }

  // A player whose recordings were all forgotten is no longer offered; nor is
  // a list of nothing.
  useEffect(() => {
    if (player && players.data && !players.data.some((p) => p.riotId.toLowerCase() === player.toLowerCase())) {
      setPlayer(null)
    }
  }, [player, players.data])

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

  const forgetMany = useMutation({
    mutationFn: (recordingIds: number[]) => window.api.recordings.forgetMany(recordingIds),
    onSuccess: (result) => {
      setForgettingPicked(false)
      setPicked(new Set())
      setNote(describeForget(result))
      refresh()
    }
  })

  const forgetServerOnly = useMutation({
    mutationFn: () => window.api.recordings.forgetServerOnly(),
    onSuccess: (result) => {
      setForgettingServerOnly(false)
      setNote(describeForget(result))
      refresh()
    }
  })

  const cleanup = useMutation({
    mutationFn: (count: number) => window.api.recordings.removeOldest(count),
    onSuccess: refresh
  })

  const rows = useMemo(() => pageItems(list.data, (recording) => recording.id), [list.data])
  const eligible = useMemo(() => uploadable.data ?? [], [uploadable.data])
  // What "select all" selects: everything you could send, as the list is filtered.
  const eligibleShown = useMemo(
    () => eligible.filter((recording) => inFilter(recording, { game: game === 'all' ? null : game, player })),
    [eligible, game, player]
  )
  const known = useMemo(
    () => new Map([...eligible, ...rows].map((recording) => [recording.id, recording] as const)),
    [eligible, rows]
  )
  const selected = useMemo(
    () => [...picked].flatMap((id) => known.get(id) ?? []),
    [picked, known]
  )
  const toUpload = selected.filter(canUpload)
  const allPicked = eligibleShown.length > 0 && eligibleShown.every((recording) => picked.has(recording.id))

  const toggle = (recordingId: number): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(recordingId)) next.delete(recordingId)
      else next.add(recordingId)
      return next
    })
  }

  const toggleAllEligible = (): void => {
    setPicked((current) => {
      const next = new Set(current)
      for (const recording of eligibleShown) {
        if (allPicked) next.delete(recording.id)
        else next.add(recording.id)
      }
      return next
    })
  }

  const playerOptions = players.data ?? []
  const filtered = game !== 'all' || player !== null
  const overCap =
    usage.data && usage.data.softCapBytes > 0 && usage.data.totalBytes > usage.data.softCapBytes
  const showBar = eligibleShown.length > 0 || selected.length > 0

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <Segmented options={GAME_FILTERS} value={game} onChange={chooseGame} size="sm" />
          {(playerOptions.length > 1 || player !== null) && (
            <select
              aria-label="Player"
              className={clsx(selectClass, 'max-w-[16rem] truncate')}
              value={player ?? ''}
              onChange={(event) => choosePlayer(event.target.value === '' ? null : event.target.value)}
            >
              <option value="">Every player</option>
              {playerOptions.map((option) => (
                <option key={option.riotId} value={option.riotId}>
                  {option.riotId} ({option.count})
                </option>
              ))}
            </select>
          )}
        </div>
        {usage.data && usage.data.count > 0 && (
          <p className="text-sm tabular-nums text-text-dim">
            {formatBytes(usage.data.totalBytes)} on this PC across {recordings(usage.data.count)}
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
              Settings, or clear out the oldest games on this PC, whoever played them.
            </p>
            <button
              type="button"
              disabled={cleanup.isPending}
              onClick={() => cleanup.mutate(5)}
              className="mt-3 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-sm font-medium text-amber transition hover:bg-amber/20 disabled:opacity-50"
            >
              Delete the {Math.min(5, usage.data.count)} oldest
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

      {usage.data && usage.data.serverOnlyCount > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-hairline bg-surface/40 px-4 py-2.5 text-xs leading-relaxed text-text-mute">
          <Icon.Server width={13} height={13} className="shrink-0 text-teal" />
          <span className="min-w-0 flex-1">
            {usage.data.serverOnlyCount === 1
              ? '1 recording is on the server and no longer on this PC — all that is left of it here is its place in this list.'
              : `${usage.data.serverOnlyCount} recordings are on the server and no longer on this PC — all that is left of them here is their place in this list.`}
          </span>
          <button
            type="button"
            onClick={() => setForgettingServerOnly(true)}
            className="shrink-0 rounded-md border border-edge px-2.5 py-1 text-text-dim transition hover:border-accent hover:text-accent"
          >
            Forget {usage.data.serverOnlyCount === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

      {showBar && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {eligibleShown.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dim">
              <input type="checkbox" className={checkboxClass} checked={allPicked} onChange={toggleAllEligible} />
              Select all {eligibleShown.length} not on the server
            </label>
          )}

          <div className="ml-auto flex items-center gap-3">
            {selected.length > 0 && (
              <>
                <span className="text-2xs tabular-nums text-text-mute">{selected.length} selected</span>
                <button
                  type="button"
                  onClick={() => setPicked(new Set())}
                  className="text-2xs text-text-mute transition hover:text-text"
                >
                  Clear
                </button>
                <button type="button" onClick={() => setForgettingPicked(true)} className={dangerButtonClass}>
                  Forget {selected.length}
                </button>
              </>
            )}
            {eligibleShown.length > 0 && (
              <button
                type="button"
                disabled={toUpload.length === 0}
                onClick={() => setBulkOpen(true)}
                title={
                  toUpload.length < selected.length
                    ? `${selected.length - toUpload.length} of the selected cannot go to the server: they are on it already, on their way, missing their file or their game, or not yours.`
                    : undefined
                }
                className={primaryButtonClass}
              >
                {toUpload.length === 0 ? 'Upload selected' : `Upload ${toUpload.length} to the server`}
              </button>
            )}
          </div>
        </div>
      )}

      <QueueBanner />

      {note && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-accent-dim/40 bg-accent/10 px-4 py-2.5 text-xs leading-relaxed text-accent">
          <span className="min-w-0 flex-1">{note}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <Icon.Close width={12} height={12} />
          </button>
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-surface/40">
        {list.isPending ? (
          <MatchListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Icon.Film />}
            title={emptyTitle(game, player)}
            description={
              filtered
                ? 'Nothing recorded on this PC matches the filter.'
                : 'Turn on game capture in Settings and play a game in one of the queues you enabled. Recording starts once the game finishes loading.'
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-hairline/60">
              {rows.map((recording) => (
                <RecordingRow
                  key={recording.id}
                  recording={recording}
                  player={playerOf(recording, mine)}
                  selected={picked.has(recording.id)}
                  onToggleSelected={() => toggle(recording.id)}
                  onDelete={() => setDeleting(recording)}
                  onForget={() => setForgetting(recording)}
                  canUpload={canUpload(recording)}
                  somebodyElses={isSomebodyElsesUpload(recording, server, mine)}
                  onUpload={() =>
                    void window.api.media.enqueue([recording.id]).then((result) => {
                      if (result.queued === 0) setNote(describeBatch(result))
                    })
                  }
                />
              ))}
            </ul>
            {list.hasNextPage && (
              <ShowMoreButton onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage} />
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

      {forgettingPicked && selected.length > 0 && (
        <ConfirmDialog
          title={selected.length === 1 ? 'Forget this recording?' : `Forget ${selected.length} recordings?`}
          message={<ForgetMessage recordings={selected} />}
          confirmLabel={`Forget ${selected.length}`}
          danger
          busy={forgetMany.isPending}
          error={forgetMany.error ? errorText(forgetMany.error) : null}
          onConfirm={() => forgetMany.mutate(selected.map((recording) => recording.id))}
          onCancel={() => setForgettingPicked(false)}
        />
      )}

      {forgettingServerOnly && usage.data && (
        <ConfirmDialog
          title={
            usage.data.serverOnlyCount === 1
              ? 'Forget the recording that is only on the server?'
              : `Forget ${usage.data.serverOnlyCount} recordings that are only on the server?`
          }
          message={
            <>
              <p>
                {usage.data.serverOnlyCount === 1
                  ? 'Its file was deleted from this PC after it went up, so all that is left of it here is its row in this list. Forgetting takes that row and its markers off this PC.'
                  : `Their files were deleted from this PC after they went up, so all that is left of them here is ${usage.data.serverOnlyCount} rows in this list. Forgetting takes those rows and their markers off this PC.`}{' '}
                This cannot be undone.
              </p>
              <p className="mt-2">
                The server keeps {usage.data.serverOnlyCount === 1 ? 'its copy' : 'every one of them'}, markers and all,
                and {usage.data.serverOnlyCount === 1 ? 'it' : 'they'} still play from the history there. Nothing with a
                file still on this PC is touched.
              </p>
            </>
          }
          confirmLabel={`Forget ${usage.data.serverOnlyCount}`}
          danger
          busy={forgetServerOnly.isPending}
          error={forgetServerOnly.error ? errorText(forgetServerOnly.error) : null}
          onConfirm={() => forgetServerOnly.mutate()}
          onCancel={() => setForgettingServerOnly(false)}
        />
      )}

      {bulkOpen && (
        <BulkUploadDialog
          recordings={toUpload}
          onClose={() => setBulkOpen(false)}
          onQueued={(result) => {
            setPicked(new Set())
            setNote(describeBatch(result))
            refresh()
          }}
        />
      )}
    </div>
  )
}

/** The empty list's title, as filtered. */
function emptyTitle(game: GameFilter, player: string | null): string {
  const what = game === 'tft' ? 'No TFT recordings' : game === 'lol' ? 'No League recordings' : 'No recordings'
  return player ? `${what} of ${player}` : `${what} yet`
}

/** An IPC error as somebody reads it, without Electron's wrapping. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
}

/**
 * What forgetting a selection does, said before it happens: how many rows,
 * that it cannot be undone, which of them still have a file here that goes
 * with them — and which of those the server has no copy of — and that the
 * server keeps what it has.
 */
function ForgetMessage({ recordings: picked }: { recordings: Recording[] }): JSX.Element {
  const one = picked.length === 1
  const withFile = picked.filter((recording) => recording.fileExists)
  const onlyCopy = withFile.filter((recording) => recording.server === null)
  const onServer = picked.filter((recording) => recording.server !== null)

  return (
    <>
      <p>
        {one
          ? 'It comes off this PC, with its markers and its upload record.'
          : `All ${picked.length} come off this PC, each with its markers and its upload record.`}{' '}
        This cannot be undone.
      </p>
      {withFile.length > 0 && (
        <p className="mt-2">
          {one
            ? 'Its video is still on this PC, and is deleted with it.'
            : `${withFile.length} of them still ${withFile.length === 1 ? 'has its' : 'have their'} video on this PC, which is deleted with ${withFile.length === 1 ? 'it' : 'them'}.`}
          {onlyCopy.length > 0 && (
            <span className="text-amber">
              {' '}
              {one || onlyCopy.length === withFile.length
                ? `${onlyCopy.length === 1 ? 'It is' : 'They are'} not on the server, so ${onlyCopy.length === 1 ? 'it is' : 'they are'} gone for good.`
                : `${onlyCopy.length} of those ${onlyCopy.length === 1 ? 'is' : 'are'} not on the server, so ${onlyCopy.length === 1 ? 'it is' : 'they are'} gone for good.`}
            </span>
          )}
        </p>
      )}
      {onServer.length > 0 && (
        <p className="mt-2">
          {onServer.length === picked.length
            ? `The server keeps ${one ? 'its copy' : 'its copies'}, markers and all, and ${one ? 'it still plays' : 'they still play'} from the history there.`
            : onServer.length === 1
              ? 'The server keeps its copy of the one that is on it, markers and all, and it still plays from the history there.'
              : `The server keeps its copies of the ${onServer.length} that are on it, markers and all, and they still play from the history there.`}
        </p>
      )}
    </>
  )
}

function RecordingRow({
  recording,
  player,
  selected,
  onToggleSelected,
  onDelete,
  onForget,
  canUpload,
  somebodyElses,
  onUpload
}: {
  recording: Recording
  /** Who it was recorded on, `gameName#tagLine`, or null when nothing here can say. */
  player: string | null
  selected: boolean
  onToggleSelected: () => void
  onDelete: () => void
  onForget: () => void
  canUpload: boolean
  /** It would go to the server but for whose it is — not one of your accounts there. */
  somebodyElses: boolean
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
      <input
        type="checkbox"
        aria-label="Select"
        className={checkboxClass}
        checked={selected}
        onChange={onToggleSelected}
      />
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
        <p className="mt-0.5 truncate text-2xs text-text-mute">
          <PlayerName riotId={player} />
          {' · '}
          {formatAge(recording.startedAt)}
          {' · '}
          {recording.durationSeconds !== null ? formatClock(recording.durationSeconds) : '—'}
          {' · '}
          {recording.fileDeleted ? 'file deleted' : formatBytes(recording.fileBytes)}
        </p>
        <ServerLine recording={recording} somebodyElses={somebodyElses} />
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

/** Whose recording a row is: the name in the row's own colour, the tag quieter. */
function PlayerName({ riotId }: { riotId: string | null }): JSX.Element {
  if (!riotId) return <span>Unknown player</span>
  const hash = riotId.lastIndexOf('#')
  if (hash <= 0) return <span className="text-text-dim">{riotId}</span>
  return (
    <span>
      <span className="text-text-dim">{riotId.slice(0, hash)}</span>
      <span>{riotId.slice(hash)}</span>
    </span>
  )
}

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

/**
 * Whether the recording found its game.
 *
 * 'unmatched' is stated plainly rather than hidden: it is the expected outcome
 * for a Practice Tool game, and a user who sees it on a ranked game learns
 * something real about their sync.
 */
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
 * the server said no) more than they need another icon. A row with nothing
 * going on that would go to the server but is somebody else's says so, where
 * its Upload button would otherwise be.
 */
function ServerLine({ recording, somebodyElses }: { recording: Recording; somebodyElses: boolean }): JSX.Element | null {
  const upload = recording.upload
  const status = uploadStatusText(recording)
  if (!status) {
    return somebodyElses ? (
      <p className="mt-1 text-2xs text-text-mute">
        Not one of your accounts on this server, so it cannot go up from here.
      </p>
    ) : null
  }

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
  } else if ((upload?.state === 'failed' || upload?.state === 'cancelled') && recording.fileExists && !somebodyElses) {
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
