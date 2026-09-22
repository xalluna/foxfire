import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Asset, EmptyState, Icon, MatchListSkeleton, useAssetManifest, championIconUrl, championName, formatAge, formatClock, kdaRatio, queueName } from '@foxfire/ui'
import { formatBytes, GB } from './bytes'
import type { Account, Replay } from '@shared/types'

/**
 * Riot's own replays.
 *
 * Deliberately thinner than the recordings tab, because there is much less to
 * manage. A replay is either playable or it says why not; there is no binding
 * to explain and no player to launch — Watch hands the file to the League
 * client and Foxfire is done with it.
 */
export function ReplaysTab({ account }: { account: Account }): JSX.Element {
  const queryClient = useQueryClient()
  const [dropping, setDropping] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const replays = useQuery({
    queryKey: ['replays', account.id],
    queryFn: () => window.api.replays.list(account.id)
  })

  const usage = useQuery({
    queryKey: ['replayUsage', account.id],
    queryFn: () => window.api.replays.usage(account.id)
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['replays', account.id] })
    void queryClient.invalidateQueries({ queryKey: ['replayUsage', account.id] })
    void queryClient.invalidateQueries({ queryKey: ['matchList', account.id] })
  }

  const remove = useMutation({
    mutationFn: (replayId: number) => window.api.replays.remove(replayId),
    onSuccess: refresh
  })

  const rescan = useMutation({
    mutationFn: () => window.api.replays.rescan(),
    onSuccess: (found) => {
      setNotice(found === 0 ? 'No new replays found.' : `Imported ${found} replay${found === 1 ? '' : 's'}.`)
      refresh()
    }
  })

  const add = useMutation({
    mutationFn: (filePath: string) => window.api.replays.add(filePath),
    onSuccess: (result) => {
      setNotice(
        !result.ok
          ? 'That file could not be read as a replay.'
          : result.replay?.matchId === null
            ? 'Added, but Foxfire could not work out which game it was.'
            : 'Added and linked to its match.'
      )
      refresh()
    }
  })

  const rows = replays.data ?? []
  const overCap =
    usage.data && usage.data.softCapBytes > 0 && usage.data.totalBytes > usage.data.softCapBytes

  /**
   * Electron exposes the real path on a dropped file, which is the whole reason
   * drag-and-drop is worth having: the main process can copy straight from it
   * without the renderer ever reading the bytes.
   */
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDropping(false)

    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.pathForFile(file))
      .filter((path): path is string => path !== null && path.toLowerCase().endsWith('.rofl'))

    if (paths.length === 0) {
      setNotice('Drop a .rofl file.')
      return
    }
    for (const path of paths) add.mutate(path)
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      className={clsx(
        'rounded-lg transition',
        dropping && 'outline-dashed outline-2 outline-offset-4 outline-accent-dim'
      )}
    >
      <ImportBanner />

      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={rescan.isPending}
            onClick={() => rescan.mutate()}
            className="rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent disabled:opacity-50"
          >
            {rescan.isPending ? 'Checking…' : 'Check for new replays'}
          </button>
          <AddReplayButton onPick={(path) => add.mutate(path)} />
        </div>
        {usage.data && usage.data.count > 0 && (
          <p className="text-sm tabular-nums text-text-dim">
            {formatBytes(usage.data.totalBytes)} across {usage.data.count}{' '}
            {usage.data.count === 1 ? 'replay' : 'replays'}
          </p>
        )}
      </div>

      {notice !== null && (
        <p className="mt-3 rounded-md border border-hairline bg-surface/40 px-4 py-2.5 text-2xs text-text-dim">
          {notice}
        </p>
      )}

      {overCap && usage.data && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/10 p-4">
          <Icon.Warning className="mt-0.5 shrink-0 text-amber" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-amber">
              Replays are past the {Math.round(usage.data.softCapBytes / GB)} GB you asked to be
              warned at.
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-text-dim">
              Nothing has been deleted — this is a reminder, not a limit. Raise the number in
              Settings, or clear out the games you are done with.
            </p>
          </div>
        </div>
      )}

      {usage.data && usage.data.unplayableCount > 0 && (
        <p className="mt-4 rounded-md border border-hairline bg-surface/40 px-4 py-2.5 text-2xs leading-relaxed text-text-mute">
          {usage.data.unplayableCount === 1
            ? '1 replay needs'
            : `${usage.data.unplayableCount} replays need`}{' '}
          a League client for a patch you no longer have installed. Riot replays only run on the
          patch that recorded them — add an older install under Settings → Riot replays → Manage
          archived clients.
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-surface/40">
        {replays.isPending ? (
          <MatchListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Icon.Film />}
            title="No replays yet"
            description="Foxfire copies the .rofl files League saves after a game. Turn replay recording on in the League client, play a game, and they will appear here — or drop a .rofl onto this tab."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {rows.map((replay) => (
              <ReplayRow key={replay.id} replay={replay} onDelete={() => remove.mutate(replay.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * The first-run import, which can be a gigabyte or two of copying.
 *
 * Shown rather than left silent: it is a lot of disk activity that the user did
 * not ask for by name, and an unexplained pause is indistinguishable from a
 * hang.
 */
function ImportBanner(): JSX.Element | null {
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    return window.api.replays.onImportProgress((next) => {
      if (next.done) {
        setProgress(null)
        void queryClient.invalidateQueries({ queryKey: ['replays'] })
        void queryClient.invalidateQueries({ queryKey: ['replayUsage'] })
      } else {
        setProgress({ current: next.current, total: next.total })
      }
    })
  }, [queryClient])

  if (progress === null) return null

  return (
    <p className="mb-4 rounded-md border border-accent-dim/40 bg-accent/10 px-4 py-2.5 text-2xs text-accent">
      Importing replays — {progress.current} of {progress.total}…
    </p>
  )
}

function AddReplayButton({ onPick }: { onPick: (path: string) => void }): JSX.Element {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent"
      >
        Add replay…
      </button>
      <input
        ref={input}
        type="file"
        accept=".rofl"
        multiple
        className="hidden"
        onChange={(event) => {
          for (const file of Array.from(event.target.files ?? [])) {
            const path = window.api.pathForFile(file)
            if (path !== null) onPick(path)
          }
          event.target.value = ''
        }}
      />
    </>
  )
}

/**
 * One replay.
 *
 * A row whose match has synced looks like any match row. One whose has not is
 * deliberately plain — date, length, patch — rather than guessing which of the
 * ten players was you from a name that may since have changed.
 */
function ReplayRow({ replay, onDelete }: { replay: Replay; onDelete: () => void }): JSX.Element {
  const assets = useAssetManifest()
  const [error, setError] = useState<string | null>(null)
  const match = replay.match
  const watchable = replay.blockedReason === null

  const watch = async (): Promise<void> => {
    const result = await window.api.replays.open(replay.id)
    setError(result.ok ? null : (result.reason ?? 'That replay could not be opened.'))
  }

  return (
    <li
      className={clsx(
        'flex flex-wrap items-center gap-3 border-l-2 px-4 py-3',
        !replay.fileExists
          ? 'border-l-hairline bg-surface/30'
          : match?.win === true
            ? 'border-l-teal bg-teal/[0.04]'
            : match?.win === false
              ? 'border-l-red bg-red/[0.04]'
              : 'border-l-hairline'
      )}
    >
      <Asset
        src={assets && match !== null ? championIconUrl(assets, match.championId) : null}
        className="h-9 w-9"
        rounded="rounded-md"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">
          {match !== null && assets
            ? championName(assets, match.championId, match.championName)
            : (match?.championName ?? 'Not linked to a match')}
          <span className="ml-2 text-2xs text-text-mute">
            {match !== null ? queueName(match.queueId, match.gameMode) : 'Riot replay'}
          </span>
        </p>
        <p className="mt-0.5 text-2xs text-text-mute">
          {formatAge(replay.recordedAt)}
          {' · '}
          {replay.durationSeconds !== null ? formatClock(replay.durationSeconds) : '—'}
          {' · '}
          {formatBytes(replay.fileBytes)}
          {replay.patch !== null && ` · patch ${replay.patch}`}
        </p>
      </div>

      {match !== null && (
        <span className="w-24 shrink-0 text-sm tabular-nums text-text-dim">
          {match.kills} / <span className="text-red">{match.deaths}</span> / {match.assists}
          <span className="ml-1 text-2xs text-text-mute">
            {kdaRatio(match.kills, match.deaths, match.assists)}
          </span>
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={!watchable}
          onClick={() => void watch()}
          title={replay.blockedReason ?? 'Open in the League client'}
          className="rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Watch
        </button>
        <IconButton
          label="Show in folder"
          disabled={!replay.fileExists}
          onClick={() => void window.api.replays.reveal(replay.id)}
        >
          <Icon.Folder width={13} height={13} />
        </IconButton>
        <IconButton label="Delete replay" onClick={onDelete} danger>
          <Icon.Trash width={13} height={13} />
        </IconButton>
      </div>

      {/* Stated on the row rather than hidden behind the disabled button, so
          "why can I watch that one and not this one" has an answer in view. */}
      {(replay.blockedReason !== null || error !== null) && (
        <p className="w-full text-2xs leading-relaxed text-amber">
          {error ?? replay.blockedReason}
        </p>
      )}
    </li>
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
