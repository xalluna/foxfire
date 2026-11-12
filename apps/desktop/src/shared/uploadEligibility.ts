import type { Account } from '@foxfire/core'
import type { Recording, RecordingUpload, UploadState } from './types'

/**
 * Which recordings can be offered for the server, decided once for both sides.
 *
 * Main answers "every eligible recording" for the Recordings tab's "select
 * all", and the tab decides which of the rows it has drawn get an Upload
 * button. If the two disagreed, select-all would pick recordings the list
 * never offered, or leave out ones it did — so the rule lives here and both
 * import it.
 */

/** Upload states that mean "on its way": it will carry on by itself. */
export const PENDING_UPLOAD_STATES: readonly UploadState[] = ['queued', 'uploading', 'paused', 'processing']

/** Whether an upload of this recording is on its way, in any state that will carry on by itself. */
export function isUploadPending(upload: Pick<RecordingUpload, 'state'> | null): boolean {
  return upload !== null && PENDING_UPLOAD_STATES.includes(upload.state)
}

/** Whose a recording is, as much as it takes to find the account on a server. */
type RecordingOwner = { accountId: string; riotId: string | null }

/** An account as the server's "mine" answers it — all an upload needs to know of it. */
type OwnAccount = Pick<Account, 'id' | 'gameName' | 'tagLine' | 'isMine'>

/**
 * The account on the server a recording belongs to: its own id, or failing
 * that its Riot ID.
 *
 * A recording made in local-only mode, or on another server, carries an
 * account id that means nothing here, and the Riot ID is what still names the
 * player. Only an account the server says is yours takes an upload — the
 * server refuses anybody else's — so `accounts` is the server's "mine", and an
 * account in it is passed over only if it says outright that it is somebody
 * else's.
 */
export function serverAccountFor<T extends OwnAccount>(recording: RecordingOwner, accounts: readonly T[]): T | null {
  const mine = accounts.filter((account) => account.isMine !== false)
  const byId = mine.find((account) => account.id === recording.accountId)
  if (byId) return byId

  const riotId = recording.riotId?.toLowerCase()
  if (!riotId) return null
  return mine.find((account) => `${account.gameName}#${account.tagLine}`.toLowerCase() === riotId) ?? null
}

/**
 * Whether the file could go to this server, leaving aside whose it is: it is
 * still on disk, it found its game — the server keeps a recording against a
 * game, so one that never found its own has nowhere to go — the server has
 * not got it yet, and no upload of it is already on its way.
 */
function canSendFile(
  recording: Pick<Recording, 'fileExists' | 'matchId' | 'server' | 'upload'>,
  serverKey: string | null
): boolean {
  if (serverKey === null || !recording.fileExists || recording.matchId === null) return false
  if (recording.server?.serverKey === serverKey) return false
  return !isUploadPending(recording.upload)
}

/**
 * Whether a recording can be sent to the server from here: the file can go
 * (see above), and it was recorded on one of your accounts there. The
 * Recordings tab lists every recording on this PC, whoever played it, and the
 * server takes an upload only from whoever claimed the account.
 */
export function canUploadRecording(
  recording: Pick<Recording, 'fileExists' | 'matchId' | 'server' | 'upload' | 'accountId' | 'riotId'>,
  serverKey: string | null,
  mine: readonly OwnAccount[]
): boolean {
  return canSendFile(recording, serverKey) && serverAccountFor(recording, mine) !== null
}

/**
 * A recording that would go to the server but for whose it is — somebody
 * else's game, recorded on this PC. The tab says so where the Upload button
 * would otherwise be.
 */
export function isSomebodyElsesUpload(
  recording: Pick<Recording, 'fileExists' | 'matchId' | 'server' | 'upload' | 'accountId' | 'riotId'>,
  serverKey: string | null,
  mine: readonly OwnAccount[]
): boolean {
  return canSendFile(recording, serverKey) && serverAccountFor(recording, mine) === null
}
