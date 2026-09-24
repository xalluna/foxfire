import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  DESCRIPTION_MAX_BYTES,
  TITLE_MAX_CHARS,
  descriptionBytes
} from '@foxfire/core/youtube'
import { UNVERIFIED_LIMIT_SECONDS } from '@shared/youtubeLimits'
import {
  Dialog,
  DialogActions,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  selectClass
} from '@foxfire/ui'
import type { YouTubePrivacy } from '@shared/types'
import { useUploadDialog } from './uploadDialog'
import { YOUTUBE_LINKS } from './links'

/**
 * Mounted once per window. Draws the upload form while a recording is chosen.
 *
 * `canOpenSettings` is false in a recording window, which has no Settings of
 * its own to send somebody to.
 */
export function YouTubeUploadDialogHost({ canOpenSettings = true }: { canOpenSettings?: boolean }): JSX.Element | null {
  const recordingId = useUploadDialog((state) => state.recordingId)
  const close = useUploadDialog((state) => state.close)
  if (recordingId === null) return null
  return (
    <YouTubeUploadDialog
      key={recordingId}
      recordingId={recordingId}
      onClose={close}
      canOpenSettings={canOpenSettings}
    />
  )
}

const PRIVACY_OPTIONS: Array<{ value: YouTubePrivacy; label: string; hint: string }> = [
  { value: 'unlisted', label: 'Unlisted', hint: 'Anybody with the link — which is everybody on your server.' },
  { value: 'public', label: 'Public', hint: 'Anybody, and it can turn up in YouTube search.' },
  { value: 'private', label: 'Private', hint: 'Only you, signed in to YouTube. It still shows on the server, but plays for nobody else.' }
]

/**
 * The upload form: title, description and who can watch.
 *
 * All three are the uploader's to choose — YouTube requires it of any app that
 * uploads — so they arrive prefilled from the templates in Settings and are
 * edited here, with YouTube's own limits counted as they are typed rather than
 * discovered after two gigabytes have gone up.
 */
function YouTubeUploadDialog({
  recordingId,
  onClose,
  canOpenSettings
}: {
  recordingId: number
  onClose: () => void
  canOpenSettings: boolean
}): JSX.Element {
  const navigate = useNavigate()
  const state = useQuery({ queryKey: ['youtubeState'], queryFn: () => window.api.youtube.getState() })
  const draft = useQuery({
    queryKey: ['youtubeDraft', recordingId],
    queryFn: () => window.api.youtube.draft(recordingId),
    staleTime: 0,
    gcTime: 0
  })

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [privacy, setPrivacy] = useState<YouTubePrivacy>('unlisted')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draft.data) return
    setTitle(draft.data.title)
    setDescription(draft.data.description)
    setPrivacy(draft.data.privacy)
  }, [draft.data])

  const titleLength = Array.from(title).length
  const bytes = descriptionBytes(description)
  const titleOk = title.trim() !== '' && titleLength <= TITLE_MAX_CHARS && !/[<>]/.test(title)
  const descriptionOk = bytes <= DESCRIPTION_MAX_BYTES && !/[<>]/.test(description)
  const longGame = (draft.data?.durationSeconds ?? 0) > UNVERIFIED_LIMIT_SECONDS

  const youtube = state.data
  const ready = youtube?.configured && youtube.email !== null

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.youtube.enqueue({ recordingId, title: title.trim(), description, privacy })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (youtube && !ready) {
    return (
      <Dialog title="Upload to YouTube" onClose={onClose}>
        <p className="text-sm leading-relaxed text-text-dim">
          {youtube.configured
            ? 'Connect a YouTube channel first, in Settings › YouTube. Foxfire uploads with your own Google sign-in.'
            : 'This build of Foxfire was made without YouTube uploads. The installer from the Releases page has them.'}
        </p>
        <DialogActions>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            Close
          </button>
          {youtube.configured && canOpenSettings && (
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
    <Dialog title="Upload to YouTube" onClose={onClose} width="max-w-xl">
      {draft.isPending ? (
        <p className="text-sm text-text-mute">Getting the recording ready…</p>
      ) : draft.isError ? (
        <p className="text-sm text-red">{draft.error instanceof Error ? draft.error.message : 'Could not read the recording.'}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (titleOk && descriptionOk) void submit()
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="yt-title" className="flex items-baseline justify-between text-sm text-text-dim">
              Title
              <span className={titleLength > TITLE_MAX_CHARS ? 'text-2xs text-red' : 'text-2xs text-text-mute'}>
                {titleLength} / {TITLE_MAX_CHARS}
              </span>
            </label>
            <input
              id="yt-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={`${inputClass} mt-1.5 w-full`}
            />
          </div>

          <div>
            <label htmlFor="yt-description" className="flex items-baseline justify-between text-sm text-text-dim">
              Description
              <span className={bytes > DESCRIPTION_MAX_BYTES ? 'text-2xs text-red' : 'text-2xs text-text-mute'}>
                {bytes.toLocaleString()} / {DESCRIPTION_MAX_BYTES.toLocaleString()} bytes
              </span>
            </label>
            <textarea
              id="yt-description"
              value={description}
              rows={7}
              onChange={(event) => setDescription(event.target.value)}
              className={`${inputClass} mt-1.5 w-full resize-y font-mono text-2xs leading-relaxed`}
            />
            <p className="mt-1 text-2xs text-text-mute">
              The timestamps become chapters on YouTube. Neither the title nor the description may contain &lt; or &gt;.
            </p>
          </div>

          <div>
            <label htmlFor="yt-privacy" className="text-sm text-text-dim">
              Who can watch
            </label>
            <select
              id="yt-privacy"
              value={privacy}
              onChange={(event) => setPrivacy(event.target.value as YouTubePrivacy)}
              className={`${selectClass} mt-1.5 block w-full`}
            >
              {PRIVACY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-2xs text-text-mute">
              {PRIVACY_OPTIONS.find((option) => option.value === privacy)?.hint}
            </p>
          </div>

          {longGame && (
            <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-2xs leading-relaxed text-amber">
              This game runs past 15 minutes. YouTube only takes videos that long from a channel that has
              verified a phone number — do that once at youtube.com/verify if the upload is refused.
            </p>
          )}

          <p className="text-2xs leading-relaxed text-text-mute">
            Uploading to {youtube?.email ?? 'your channel'}. By uploading you agree to the{' '}
            <a href={YOUTUBE_LINKS.terms} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              YouTube Terms of Service
            </a>
            ; Google handles the video under the{' '}
            <a href={YOUTUBE_LINKS.googlePrivacy} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Google Privacy Policy
            </a>
            . Not made for kids. The upload pauses while a game is on and carries on after a restart.
          </p>

          {error && <p className="text-sm text-red">{error}</p>}

          <DialogActions>
            <button type="button" className={ghostButtonClass} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass} disabled={!titleOk || !descriptionOk || busy}>
              {busy ? 'Queueing…' : 'Upload'}
            </button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  )
}
