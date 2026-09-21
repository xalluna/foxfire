import type { Platform } from '@foxfire/screens'
import type { ImportProgress } from '@foxfire/core'
import type { Api } from '@shared/api'
import { LcuIndicator } from '../components/LcuIndicator'

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

    watchRecording: (recordingId) => void api.recordings.open(recordingId),

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
