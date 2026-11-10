import type { Platform } from '@foxfire/screens'
import type { ImportProgress } from '@foxfire/core'
import type { Api } from '@shared/api'
import { LcuIndicator } from '../components/LcuIndicator'
import { createRelayMount } from '../recording/mediaRelayMount'

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

    // The file on this disk when there is one. Otherwise the server's copy:
    // somebody else's recording, or this machine's own after its file was
    // deleted once the server had it.
    watchRecording: ({ account, match }) => {
      const recordingId = match.local?.recordingId ?? null
      if (recordingId !== null && !match.local?.recordingFileDeleted) void api.recordings.open(recordingId)
      else void api.recordings.openRemote(account.id, match.matchId)
    },

    // The server's player, through its relay page — see recording/mediaRelayMount.ts.
    media: createRelayMount(api),

    // Into the queue, titled from the template. The queue says how it goes.
    uploadRecording: async ({ match }) => {
      const recordingId = match.local?.recordingId ?? null
      if (recordingId === null) return { ok: false, message: 'This PC has no recording of that game.' }
      const result = await api.media.enqueue([recordingId])
      return result.queued > 0 ? { ok: true } : { ok: false, message: result.skipped[0]?.reason }
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
