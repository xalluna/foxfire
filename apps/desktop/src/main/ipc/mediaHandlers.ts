import { ipcMain } from 'electron'
import { serverBacked } from '../api'
import { getDb } from '../db'
import { getRecordingIdentity } from '../db/repositories/recordings.repo'
import { serverAccountFor } from '../media/serverAccount'
import { openRemoteRecordingWindow } from '../recordingWindow'
import { serverApi } from '../services/serverService'
import { listUploadableRecordings } from '../services/recordingService'
import { backlog, cancelUpload, enqueue, enqueueAll, pauseAll, queueState, resumeAll, retryUpload } from '../media/queue'
import { getMediaSettings, setMediaSettings } from '../media/settings'
import { CH } from './channels'
import type { EnqueueOptions, MediaSettings, UploadTrigger } from '@shared/types'

/**
 * Every channel that belongs to recordings on the server.
 *
 * The upload tokens stay in this process throughout; the renderer asks for
 * things to happen and is told what the queue became.
 */
export function registerMediaHandlers(): void {
  // A server's recordings: its copy of one account's view of one game.
  ipcMain.handle(CH.matchRecordings.get, (_e, accountId: string, matchId: string) =>
    serverBacked().matchRecordings.get(accountId, matchId)
  )
  ipcMain.handle(CH.matchRecordings.embed, (_e, accountId: string, matchId: string) =>
    serverBacked().matchRecordings.embed(accountId, matchId)
  )
  ipcMain.handle(CH.matchRecordings.remove, (_e, accountId: string, matchId: string) =>
    serverBacked().matchRecordings.remove(accountId, matchId)
  )

  // Somebody else's recording, or this machine's own after its file was deleted.
  ipcMain.handle(CH.recordings.openRemote, (_e, accountId: string, matchId: string) =>
    openRemoteRecordingWindow(accountId, matchId)
  )

  // This PC's own, under the server's name for its account, which is what the
  // server's recording is filed under.
  ipcMain.handle(CH.recordings.openServerCopy, async (_e, recordingId: number) => {
    const identity = getRecordingIdentity(getDb(), recordingId)
    if (!identity?.matchId) return
    const account = serverAccountFor(identity, await serverApi().accounts.mine())
    if (account) openRemoteRecordingWindow(account.id, identity.matchId)
  })

  // Every recording that could go up, whole, for "select all" on a list that is
  // otherwise paged — this PC's, recorded on one of your accounts there.
  ipcMain.handle(CH.recordings.eligible, () => listUploadableRecordings())

  ipcMain.handle(CH.media.getSettings, () => getMediaSettings())
  ipcMain.handle(CH.media.setSettings, (_e, patch: Partial<MediaSettings>) => setMediaSettings(patch))
  ipcMain.handle(CH.media.getQueue, () => queueState())
  ipcMain.handle(
    CH.media.enqueue,
    (_e, recordingIds: number[], options?: EnqueueOptions & { trigger?: UploadTrigger }) =>
      enqueue(recordingIds, options?.trigger === 'bulk' ? 'bulk' : 'manual', { deleteAfter: options?.deleteAfter })
  )
  ipcMain.handle(CH.media.enqueueAll, (_e, options?: EnqueueOptions) => enqueueAll(options))
  ipcMain.handle(CH.media.backlog, () => backlog())
  ipcMain.handle(CH.media.cancel, (_e, recordingId: number) => cancelUpload(recordingId))
  ipcMain.handle(CH.media.retry, (_e, recordingId: number) => retryUpload(recordingId))
  ipcMain.handle(CH.media.pauseAll, () => pauseAll())
  ipcMain.handle(CH.media.resumeAll, () => resumeAll())
}
