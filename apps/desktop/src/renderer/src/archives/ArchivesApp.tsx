import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Icon, EmptyState } from '@foxfire/ui'
import type { ArchiveCopyProgress, ClientArchive } from '@shared/types'

/**
 * The register of League installs kept for old replays.
 *
 * The thing this window has to make obvious is *why* it exists, because the
 * requirement is not intuitive: a .rofl is not a video, it is a command log the
 * game engine re-runs, so it only means anything to the exact build that
 * produced it. Riot ships one install and patches it in place. Two weeks after
 * a game, the only thing that can still play its replay is a copy of the client
 * from before the patch.
 *
 * So this is a filing cabinet, not a setting. Foxfire remembers where those
 * installs are; it does not, by default, make them.
 */
export function ArchivesApp(): JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const archives = useQuery({
    queryKey: ['archives'],
    queryFn: () => window.api.archives.list()
  })

  const live = useQuery({
    queryKey: ['liveClient'],
    queryFn: () => window.api.archives.live()
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['archives'] })
  }

  const add = useMutation({
    mutationFn: async () => {
      const path = await window.api.archives.choosePath()
      return path === null ? null : window.api.archives.add(path, null)
    },
    onSuccess: (result) => {
      if (result === null) return
      setError(result.ok ? null : (result.error ?? 'That install could not be added.'))
      refresh()
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.archives.remove(id),
    onSuccess: refresh
  })

  const rows = archives.data ?? []

  return (
    <div className="min-h-screen bg-canvas text-text">
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="font-display text-xl">Archived clients</h1>
        <p className="mt-2 text-2xs leading-relaxed text-text-mute">
          Riot replays only run on the patch that recorded them, and League keeps just one install —
          the current one. To watch a replay from an older patch you need that patch&rsquo;s game
          files. Point Foxfire at any you have kept and it will use them automatically.
        </p>

        <LiveRow path={live.data?.path ?? null} patch={live.data?.patch ?? null} />

        {error !== null && (
          <p className="mt-4 rounded-md border border-red/30 bg-red/10 px-4 py-2.5 text-2xs text-red">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-4">
          <h2 className="font-display text-sm text-text-dim">Archives</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={add.isPending}
              onClick={() => add.mutate()}
              className="rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent disabled:opacity-50"
            >
              Add existing install…
            </button>
            <ArchiveLiveButton
              livePatch={live.data?.patch ?? null}
              onDone={refresh}
              onError={setError}
            />
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-hairline bg-surface/40">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon.Folder />}
              title="No archived clients"
              description="Replays from the current patch play without any of this. Add an install here only when you want to keep watching older ones."
            />
          ) : (
            <ul className="divide-y divide-hairline/60">
              {rows.map((archive) => (
                <ArchiveRow
                  key={archive.id}
                  archive={archive}
                  onRemove={() => remove.mutate(archive.id)}
                  onChanged={refresh}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The live install, listed but not editable.
 *
 * Shown because its absence would be confusing — a user with no archives and a
 * working current-patch replay would otherwise see an empty screen and conclude
 * nothing works. It is never a stored row: its patch changes every two weeks.
 */
function LiveRow({ path, patch }: { path: string | null; patch: string | null }): JSX.Element {
  return (
    <div className="mt-5 rounded-lg border border-hairline bg-surface/40 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text">Current install</span>
        <span className="text-2xs tabular-nums text-text-dim">
          {patch === null ? 'patch unknown' : `patch ${patch}`}
        </span>
      </div>
      <p className="mt-1 truncate text-2xs text-text-mute">
        {path ?? 'Foxfire could not find your League install.'}
      </p>
      <p className="mt-1 text-2xs text-text-mute">
        Always available, never listed below — replays from this patch need nothing extra.
      </p>
    </div>
  )
}

function ArchiveRow({
  archive,
  onRemove,
  onChanged,
  onError
}: {
  archive: ClientArchive
  onRemove: () => void
  onChanged: () => void
  onError: (message: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(archive.patch)

  const save = async (): Promise<void> => {
    const result = await window.api.archives.setPatch(archive.id, draft)
    if (!result.ok) {
      onError(result.error ?? 'That patch could not be saved.')
      return
    }
    setEditing(false)
    onChanged()
  }

  return (
    <li
      className={clsx(
        'flex items-center gap-3 border-l-2 px-4 py-3',
        archive.pathExists ? 'border-l-hairline' : 'border-l-amber bg-amber/[0.04]'
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">{archive.label ?? archive.path}</p>
        <p className="mt-0.5 truncate text-2xs text-text-mute">
          {archive.label === null ? '' : `${archive.path} · `}
          {archive.patchSource === 'manual' ? 'patch set by hand' : 'patch read from the install'}
          {!archive.pathExists && ' · folder is missing'}
        </p>
      </div>

      {editing ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="15.14"
            className="w-20 rounded-md border border-hairline bg-canvas px-2 py-1 text-sm tabular-nums text-text"
          />
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-md border border-accent-dim bg-accent/10 px-2.5 py-1 text-2xs text-accent"
          >
            Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Set the patch by hand"
          className="shrink-0 rounded border border-hairline bg-canvas px-2 py-0.5 text-2xs tabular-nums text-text-dim transition hover:border-accent-dim hover:text-accent"
        >
          {archive.patch}
        </button>
      )}

      <button
        type="button"
        title="Remove from the list"
        aria-label="Remove from the list"
        onClick={onRemove}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hairline text-text-mute transition hover:border-red/40 hover:text-red"
      >
        <Icon.Trash width={13} height={13} />
      </button>
    </li>
  )
}

/**
 * Copying the live install.
 *
 * Deliberately a button the user presses, never something that happens on patch
 * day. This moves tens of gigabytes; doing it automatically every two weeks
 * would fill a drive on the user's behalf.
 */
function ArchiveLiveButton({
  livePatch,
  onDone,
  onError
}: {
  livePatch: string | null
  onDone: () => void
  onError: (message: string) => void
}): JSX.Element {
  const [progress, setProgress] = useState<ArchiveCopyProgress | null>(null)

  useEffect(() => {
    return window.api.archives.onCopyProgress((next) => {
      setProgress(next.done ? null : next)
    })
  }, [])

  const start = async (): Promise<void> => {
    const destination = await window.api.archives.choosePath()
    if (destination === null) return

    setProgress({ copiedBytes: 0, totalBytes: 0, currentFile: null, done: false, cancelled: false })
    const result = await window.api.archives.archiveLive(destination)
    setProgress(null)

    if (!result.ok) onError(result.error ?? 'The copy did not finish.')
    onDone()
  }

  if (progress !== null) {
    const pct =
      progress.totalBytes === 0 ? 0 : Math.round((progress.copiedBytes / progress.totalBytes) * 100)
    return (
      <div className="flex items-center gap-2">
        <span className="text-2xs tabular-nums text-text-dim">Copying… {pct}%</span>
        <button
          type="button"
          onClick={() => void window.api.archives.cancelCopy()}
          className="rounded-md border border-hairline px-2.5 py-1 text-2xs text-text-dim transition hover:border-red/40 hover:text-red"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={livePatch === null}
      onClick={() => void start()}
      title={
        livePatch === null
          ? 'Foxfire could not read the patch of your League install'
          : `Copy the current install so patch ${livePatch} stays playable`
      }
      className="rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent disabled:opacity-50"
    >
      Archive current patch…
    </button>
  )
}
