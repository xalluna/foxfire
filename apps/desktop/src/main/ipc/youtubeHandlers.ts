import { ipcMain } from 'electron'
import { serverBacked } from '../api'
import { openRemoteRecordingWindow } from '../recordingWindow'
import { attachLink, reattach } from '../youtube/attach'
import { enqueueBatch } from '../youtube/bulk'
import { draftFor } from '../youtube/drafts'
import { cancelConnect, connectYouTube, disconnectYouTube } from '../youtube/oauth'
import { cancelUpload, enqueue, kick, retryUpload } from '../youtube/queue'
import { getYouTubeSettings, setYouTubeSettings } from '../youtube/settings'
import { broadcastYouTubeState, youTubeState } from '../youtube/state'
import { CH } from './channels'
import type { AttachRecordingInput, UploadRequest, YouTubePrivacy, YouTubeSettings } from '@shared/types'

/**
 * Every channel that belongs to recordings on YouTube.
 *
 * Kept apart from handlers.ts so a build made without the feature — see
 * shared/features.ts — registers none of them with one condition, rather than
 * a condition on each. The Google tokens stay in this process throughout; the
 * renderer asks for things to happen and is told what the state became.
 */
export function registerYouTubeHandlers(): void {
  // A server's recordings: its copy of one account's view of one game.
  ipcMain.handle(CH.matchRecordings.get, (_e, accountId: string, matchId: string) =>
    serverBacked().matchRecordings.get(accountId, matchId)
  )
  ipcMain.handle(
    CH.matchRecordings.attach,
    (_e, accountId: string, matchId: string, input: AttachRecordingInput) =>
      serverBacked().matchRecordings.attach(accountId, matchId, input)
  )
  ipcMain.handle(CH.matchRecordings.detach, (_e, accountId: string, matchId: string) =>
    serverBacked().matchRecordings.detach(accountId, matchId)
  )

  // Somebody else's recording, or this machine's own after its file was forgotten.
  ipcMain.handle(CH.recordings.openRemote, (_e, accountId: string, matchId: string) =>
    openRemoteRecordingWindow(accountId, matchId)
  )

  ipcMain.handle(CH.youtube.getState, () => youTubeState())
  ipcMain.handle(CH.youtube.connect, async () => {
    await connectYouTube()
    // Anything that was waiting for a connection can go now.
    kick()
    broadcastYouTubeState()
  })
  ipcMain.handle(CH.youtube.cancelConnect, () => cancelConnect())
  ipcMain.handle(CH.youtube.disconnect, async () => {
    await disconnectYouTube()
    broadcastYouTubeState()
    kick()
  })
  ipcMain.handle(CH.youtube.getSettings, () => getYouTubeSettings())
  ipcMain.handle(CH.youtube.setSettings, (_e, patch: Partial<YouTubeSettings>) => setYouTubeSettings(patch))
  ipcMain.handle(CH.youtube.draft, (_e, recordingId: number) => draftFor(recordingId))
  ipcMain.handle(CH.youtube.enqueue, (_e, request: UploadRequest) => enqueue(request))
  ipcMain.handle(CH.youtube.enqueueMany, (_e, recordingIds: number[], privacy: YouTubePrivacy) =>
    enqueueBatch(recordingIds, privacy)
  )
  ipcMain.handle(CH.youtube.cancel, (_e, recordingId: number) => cancelUpload(recordingId))
  ipcMain.handle(CH.youtube.retry, (_e, recordingId: number) => retryUpload(recordingId))
  ipcMain.handle(CH.youtube.attachLink, (_e, recordingId: number, videoId: string, replace: boolean) =>
    attachLink(recordingId, videoId, replace)
  )
  ipcMain.handle(CH.youtube.reattach, (_e, recordingId: number) => reattach(recordingId, true))
}
