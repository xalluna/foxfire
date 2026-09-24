import { useState } from 'react'
import type { AttachRecordingOutcome } from '@foxfire/core'
import { parseYouTubeVideoId } from '@foxfire/core/youtube'
import { Dialog, DialogActions } from '../components/Dialog'
import { ghostButtonClass, inputClass, primaryButtonClass } from '../components/settings/controls'

/**
 * "Attach a YouTube link", for a video somebody uploaded themselves.
 *
 * The id is read out of whatever was pasted — a share link, a Shorts address,
 * a watch URL with a playlist on the end — and only the id is sent. A game
 * that already has a recording is not refused but asked about: the attach
 * comes back `exists`, the dialog says what is there, and a second press
 * replaces it.
 */
export function AttachLinkDialog({
  replacing,
  withMarkers,
  onAttach,
  onClose
}: {
  /** A recording is already on this game, so attaching is replacing. */
  replacing: boolean
  /** Whether this recording's markers go with the link — only from the desktop that recorded it. */
  withMarkers: boolean
  onAttach: (videoId: string, replace: boolean) => Promise<AttachRecordingOutcome>
  onClose: () => void
}): JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const videoId = parseYouTubeVideoId(text)
  const typedSomething = text.trim() !== ''

  const submit = async (replace: boolean): Promise<void> => {
    if (!videoId) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await onAttach(videoId, replace || replacing)
      if (outcome.ok) {
        onClose()
        return
      }
      if (outcome.reason === 'exists') setConfirming(outcome.message)
      else setError(outcome.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={replacing ? 'Replace the YouTube link' : 'Attach a YouTube link'} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit(confirming !== null)
        }}
      >
        <label className="block text-sm text-text-dim" htmlFor="youtube-link">
          The video on YouTube
        </label>
        <input
          id="youtube-link"
          autoFocus
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setConfirming(null)
            setError(null)
          }}
          placeholder="https://youtu.be/…"
          className={`${inputClass} mt-1.5 w-full`}
        />

        <p className="mt-2 text-2xs leading-relaxed text-text-mute">
          {typedSomething && !videoId
            ? 'That is not a YouTube video link.'
            : withMarkers
              ? 'Kills, deaths and assists from this recording go with it, so the video has to be the same file, uncut.'
              : 'Linked from here, it plays without the kill and death markers — those come from the desktop that recorded the game.'}
        </p>

        {replacing && confirming === null && (
          <p className="mt-2 text-sm text-text-dim">
            This game already has a recording. The new link replaces it; the old video stays on YouTube.
          </p>
        )}

        {confirming !== null && (
          <p className="mt-3 text-sm text-text-dim">
            {confirming} Replace it? The old video stays on YouTube.
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red">{error}</p>}

        <DialogActions>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={!videoId || busy}>
            {busy ? 'Attaching…' : confirming !== null || replacing ? 'Replace' : 'Attach'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
