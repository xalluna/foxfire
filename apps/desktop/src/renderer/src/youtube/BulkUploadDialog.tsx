import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { renderRecordingTitle, UNMATCHED_TITLE_TEMPLATE } from '@foxfire/core/youtube'
import {
  Dialog,
  DialogActions,
  championName,
  ghostButtonClass,
  primaryButtonClass,
  selectClass,
  useAssetManifest
} from '@foxfire/ui'
import { UNVERIFIED_LIMIT_SECONDS } from '@shared/youtubeLimits'
import type { BulkUploadResult, Recording, YouTubePrivacy } from '@shared/types'
import { YOUTUBE_LINKS } from './links'

const GB = 1024 * 1024 * 1024

/**
 * A title for one recording, from the template, as the batch will name it —
 * the champion's name falling back to the asset list, as the upload's own
 * draft does.
 */
function titleFor(recording: Recording, template: string, champion: (id: number) => string | null): string {
  const match = recording.match
  const championId = match?.championId ?? recording.selfChampionId
  return renderRecordingTitle(match ? template : UNMATCHED_TITLE_TEMPLATE, {
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
 * Many recordings to YouTube at once.
 *
 * One choice for the whole batch — who can watch — and everything else from
 * the templates in Settings, which is what YouTube asks of an app that uploads
 * on somebody's behalf: they chose the title and the privacy, once, for all of
 * these. Each video is still named after its own game.
 *
 * Says up front what the batch will cost, in the two currencies that matter:
 * the time it takes to push this many gigabytes through a home connection, and
 * YouTube's daily upload allowance, which a batch this size can outrun.
 */
export function BulkUploadDialog({
  recordings,
  onClose,
  onQueued
}: {
  recordings: Recording[]
  onClose: () => void
  onQueued: (result: BulkUploadResult) => void
}): JSX.Element {
  const navigate = useNavigate()
  const assets = useAssetManifest()
  const champion = (id: number): string | null => (assets ? championName(assets, id) : null)
  const state = useQuery({ queryKey: ['youtubeState'], queryFn: () => window.api.youtube.getState() })
  const settings = useQuery({ queryKey: ['youtubeSettings'], queryFn: () => window.api.youtube.getSettings() })

  const [privacy, setPrivacy] = useState<YouTubePrivacy>('unlisted')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings.data) setPrivacy(settings.data.defaultPrivacy)
  }, [settings.data])

  const youtube = state.data
  const count = recordings.length
  const bytes = recordings.reduce((total, recording) => total + (recording.fileBytes ?? 0), 0)
  const unmatched = recordings.filter((recording) => !recording.match).length
  const longGames = recordings.filter((recording) => (recording.durationSeconds ?? 0) > UNVERIFIED_LIMIT_SECONDS).length
  const example = recordings.find((recording) => recording.match) ?? recordings[0]

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.youtube.enqueueMany(
        recordings.map((recording) => recording.id),
        privacy
      )
      onQueued(result)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const title = `Upload ${count} recording${count === 1 ? '' : 's'} to YouTube`

  if (youtube && (!youtube.configured || youtube.email === null)) {
    return (
      <Dialog title={title} onClose={onClose}>
        <p className="text-sm leading-relaxed text-text-dim">
          {youtube.configured
            ? 'Connect a YouTube channel first, in Settings › YouTube. Foxfire uploads with your own Google sign-in.'
            : 'This build of Foxfire was made without YouTube uploads. The installer from the Releases page has them.'}
        </p>
        <DialogActions>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            Close
          </button>
          {youtube.configured && (
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => {
                onClose()
                void navigate({ to: '/settings/{-$category}', params: { category: 'youtube' } })
              }}
            >
              Open Settings
            </button>
          )}
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <Dialog title={title} onClose={onClose} width="max-w-lg">
      <div className="space-y-4 text-sm leading-relaxed text-text-dim">
        <p>
          {bytes > 0 && (
            <>
              {(bytes / GB).toFixed(1)} GB in all.{' '}
            </>
          )}
          They go up one at a time, oldest game first, in the background. Uploads pause while you are in
          a game and carry on after a restart, so you can leave this running for as long as it takes.
        </p>

        <div>
          <label htmlFor="bulk-privacy" className="text-sm text-text-dim">
            Who can watch, for all of them
          </label>
          <select
            id="bulk-privacy"
            value={privacy}
            onChange={(event) => setPrivacy(event.target.value as YouTubePrivacy)}
            className={`${selectClass} mt-1.5 block w-full`}
          >
            <option value="unlisted">Unlisted — anybody with the link, which is everybody on your server</option>
            <option value="public">Public — anybody, and it can turn up in YouTube search</option>
            <option value="private">Private — only you, signed in to YouTube</option>
          </select>
        </div>

        {settings.data && example && (
          <p className="text-2xs text-text-mute">
            Each is titled from your template in Settings › YouTube — for example{' '}
            <span className="text-text-dim">&ldquo;{titleFor(example, settings.data.titleTemplate, champion)}&rdquo;</span> — and
            described with its own kills and deaths.
            {unmatched > 0 &&
              ` ${unmatched} never found ${unmatched === 1 ? 'its game, so it is' : 'their game, so they are'} titled with the date instead.`}
          </p>
        )}

        {count > 10 && (
          <p className="rounded-md border border-hairline bg-surface-2/60 px-3 py-2 text-2xs text-text-dim">
            YouTube allows Foxfire about 100 uploads a day, shared by everybody who uses it, and your channel
            has a daily limit of its own. Whatever does not fit today waits and carries on by itself the next
            day.
          </p>
        )}

        {longGames > 0 && (
          <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-2xs text-amber">
            {longGames} of these run past 15 minutes. YouTube only takes videos that long from a channel that
            has verified a phone number — do that once at youtube.com/verify first, or those uploads will be
            refused.
          </p>
        )}

        <p className="text-2xs text-text-mute">
          Uploading to {youtube?.email ?? 'your channel'}. By uploading you agree to the{' '}
          <a href={YOUTUBE_LINKS.terms} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            YouTube Terms of Service
          </a>
          ; Google handles the videos under the{' '}
          <a href={YOUTUBE_LINKS.googlePrivacy} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Google Privacy Policy
          </a>
          . Not made for kids.
        </p>

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
