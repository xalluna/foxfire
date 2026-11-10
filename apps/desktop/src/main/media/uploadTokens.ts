import { clearSecret, loadSecret, saveSecret } from '../security/keyStore'

/**
 * The one-time token each upload runs on, kept in the encrypted secret store.
 *
 * Not in SQLite, because it is a credential: it opens one upload of one file
 * on the server's Foxfire Media, and the database is a file somebody might
 * reasonably hand over when reporting a problem. Kept at all — rather than
 * held in memory — so an upload the app quit in the middle of can carry on
 * after a restart, from where it got to, while Foxfire Media still has it.
 */
function name(recordingId: number): string {
  return `media-upload-${recordingId}`
}

export function saveUploadToken(recordingId: number, token: string): void {
  saveSecret(name(recordingId), token)
}

export function loadUploadToken(recordingId: number): string | null {
  return loadSecret(name(recordingId))
}

export function clearUploadToken(recordingId: number): void {
  clearSecret(name(recordingId))
}
