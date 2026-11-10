import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  renderRecordingTitle,
  renderTftRecordingTitle,
  UNMATCHED_TFT_TITLE_TEMPLATE,
  UNMATCHED_TITLE_TEMPLATE
} from '@foxfire/core/recordings'
import {
  Dialog,
  DialogActions,
  championName,
  ghostButtonClass,
  primaryButtonClass,
  tftName,
  useAssetManifest
} from '@foxfire/ui'
import { tftTitleFacts } from '@shared/tftRecordingTitle'
import type { BulkUploadResult, Recording } from '@shared/types'
import { formatBytes } from './uploadStatus'

/**
 * A title for one recording, from the template, as the queue will name it —
 * the champion's name falling back to the asset list, as the queue's own does.
 */
function titleFor(
  recording: Recording,
  templates: { league: string; tft: string },
  champion: (id: number) => string | null,
  trait: (id: string) => string
): string {
  if (recording.game === 'tft') {
    const facts = tftTitleFacts(recording, recording.tftMatch, trait)
    return renderTftRecordingTitle(facts.placement === null ? UNMATCHED_TFT_TITLE_TEMPLATE : templates.tft, facts)
  }

  const match = recording.match
  const championId = match?.championId ?? recording.selfChampionId
  return renderRecordingTitle(match ? templates.league : UNMATCHED_TITLE_TEMPLATE, {
    champion: match?.championName ?? (championId === null ? null : champion(championId)),
    queueId: match?.queueId ?? recording.queueId,
    gameMode: match?.gameMode ?? null,
    win: match ? match.win : null,
    kills: match?.kills ?? null,
    deaths: match?.deaths ?? null,
    assists: match?.assists ?? null,
    playedAt: recording.startedAt
  })
}

/**
 * Many recordings to the server at once — or, with `everything`, every one on
 * this PC the server does not have yet, which is how a backlog of hundreds of
 * gigabytes goes up.
 *
 * One choice for the whole batch: whether each file stays on this PC once the
 * server has it ready, or goes. Defaulted from Settings, and decided now for
 * all of them — changing the setting later does not reach into a batch
 * already on its way. Titles come from the template.
 */
export function BulkUploadDialog({
  recordings,
  everything,
  onClose,
  onQueued
}: {
  /** The recordings picked, or a stand-in count and size when `everything` is set. */
  recordings: Recording[]
  everything?: { count: number; bytes: number }
  onClose: () => void
  onQueued: (result: BulkUploadResult) => void
}): JSX.Element {
  const assets = useAssetManifest()
  const champion = (id: number): string | null => (assets ? championName(assets, id) : null)
  const trait = (id: string): string => tftName(assets, 'traits', id)
  const settings = useQuery({ queryKey: ['mediaSettings'], queryFn: () => window.api.media.getSettings() })

  const [deleteAfter, setDeleteAfter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings.data) setDeleteAfter(settings.data.afterUpload === 'delete')
  }, [settings.data])

  const count = everything?.count ?? recordings.length
  const bytes = everything?.bytes ?? recordings.reduce((total, recording) => total + (recording.fileBytes ?? 0), 0)
  const example = recordings.find((recording) => recording.match ?? recording.tftMatch) ?? recordings[0]

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = everything
        ? await window.api.media.enqueueAll({ deleteAfter })
        : await window.api.media.enqueue(
            recordings.map((recording) => recording.id),
            { deleteAfter, trigger: 'bulk' }
          )
      onQueued(result)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const title = `Upload ${count} recording${count === 1 ? '' : 's'} to the server`

  return (
    <Dialog title={title} onClose={onClose} width="max-w-lg">
      <div className="space-y-4 text-sm leading-relaxed text-text-dim">
        <p>
          {bytes > 0 && <>{formatBytes(bytes)} in all. </>}
          They go up one at a time, oldest game first, in the background and straight to the server&rsquo;s
          video storage. Uploads pause while you are in a game and carry on after a restart, so you can leave
          this running for as long as it takes.
        </p>

        <fieldset>
          <legend className="text-sm text-text-dim">Once the server has each one ready</legend>
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="after-upload"
                checked={!deleteAfter}
                onChange={() => setDeleteAfter(false)}
                className="mt-1 accent-accent"
              />
              <span>
                <span className="text-text">Keep it on this PC</span>
                <span className="block text-2xs text-text-mute">The file stays where it is. Nothing is deleted.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="after-upload"
                checked={deleteAfter}
                onChange={() => setDeleteAfter(true)}
                className="mt-1 accent-accent"
              />
              <span>
                <span className="text-text">Delete it from this PC</span>
                <span className="block text-2xs text-text-mute">
                  Only after the server says the video is ready to watch. The recording and its markers stay in
                  your history, and play from the server.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {deleteAfter && bytes > 0 && (
          <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
            That frees {formatBytes(bytes)} here as the uploads finish. Once a file is gone, the server&rsquo;s copy
            is the only one.
          </p>
        )}

        {settings.data && example && (
          <p className="text-2xs text-text-mute">
            Each is titled from your template in Settings › Server recordings — for example{' '}
            <span className="text-text-dim">
              &ldquo;
              {titleFor(
                example,
                { league: settings.data.titleTemplate, tft: settings.data.tftTitleTemplate },
                champion,
                trait
              )}
              &rdquo;
            </span>
            .
          </p>
        )}

        {error && <p className="text-sm text-red">{error}</p>}
      </div>

      <DialogActions>
        <button type="button" className={ghostButtonClass} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryButtonClass} disabled={busy || count === 0} onClick={() => void submit()}>
          {busy ? 'Queueing…' : `Queue ${count} upload${count === 1 ? '' : 's'}`}
        </button>
      </DialogActions>
    </Dialog>
  )
}
