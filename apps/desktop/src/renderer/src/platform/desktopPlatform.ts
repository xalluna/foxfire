import type { Platform } from '@foxfire/screens'
import type { ImportProgress } from '@foxfire/core'
import type { Api } from '@shared/api'
import { LcuIndicator } from '../components/LcuIndicator'
import { youtubeHostMount } from '../recording/youtubeHostMount'
import { openUploadDialog } from '../youtube/uploadDialog'

/**
 * What this machine can do that a browser cannot, as the shared screens ask
 * for it.
 *
 * Every one of these is an IPC call the renderer was already making — the
 * screens simply no longer make it themselves. That is the whole of the
 * difference between the two clients as far as the screens are concerned: a
 * browser supplies fewer of these, and the menus offer less.
 */
export function createDesktopPlatform(api: Api): Platform {
  return {
    kind: 'desktop',

    copyText: (text) => navigator.clipboard.writeText(text),

    // Its own window, because the editor is worth keeping open beside the
    // match list while the rows it fixes update underneath it.
    openLpEditor: ({ account, queueType, matchId }) =>
      void api.rank.openEditor(account.id, queueType, matchId),

    // The file on this disk when there is one — it plays from YouTube anyway
    // if it has gone up, with a switch back to the file. Otherwise the
    // server's copy: somebody else's recording, or this machine's own after
    // its file was forgotten.
    watchRecording: ({ account, match }) => {
      const recordingId = match.local?.recordingId ?? null
      if (recordingId !== null) void api.recordings.open(recordingId)
      else void api.recordings.openRemote(account.id, match.matchId)
    },

    youtube: youtubeHostMount,

    uploadRecording: ({ match }) => {
      const recordingId = match.local?.recordingId ?? null
      if (recordingId !== null) openUploadDialog(recordingId)
    },

    // Through this machine's recording when it has one, so the markers go
    // with the link; otherwise the screen attaches through the server itself.
    attachRecordingLink: async ({ match, videoId, replace }) => {
      const recordingId = match.local?.recordingId ?? null
      return recordingId === null ? null : api.youtube.attachLink(recordingId, videoId, replace)
    },

    launchReplay: async (replayId) => {
      const result = await api.replays.open(replayId)
      return { ok: result.ok, message: result.reason }
    },

    // Into the replay library, where it lists and plays like any other. The
    // match row picks up its new state off the replays-changed broadcast.
    downloadReplay: async (matchId) => {
      const id = await api.replays.download(matchId)
      return id === null
        ? { ok: false, message: 'That replay could not be downloaded from the server.' }
        : { ok: true }
    },

    statsDbImport: {
      pick: async () => {
        const path = await api.serverAdmin.chooseDatabase()
        return path === null ? null : { source: path, label: path }
      },

      // The main process reads the file and does the pushing; progress arrives
      // on its own channel for as long as the run takes.
      run: async (source, onProgress: (progress: ImportProgress) => void) => {
        const unsubscribe = api.serverAdmin.onImportProgress(onProgress)
        try {
          return await api.serverAdmin.importDatabase(source as string)
        } finally {
          unsubscribe()
        }
      }
    },

    slots: {
      rankHeaderExtra: LcuIndicator
    }
  }
}
