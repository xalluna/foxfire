import { paths, rankQueueParam } from '@foxfire/core/routes'
import type { ServerApi } from '@foxfire/core/server'
import type { Platform } from '@foxfire/screens'
import { importStatsDbFile, pickStatsDb } from './statsDb'
import { createWebYouTubeMount } from './youtubePlayer'

/**
 * What a browser can do beyond reading and writing through the server.
 *
 * Less than a desktop, by design and by necessity: there is no League client
 * to watch, no recordings on this disk and no replays to launch, so those
 * actions are simply not here — and the screens leave out every menu item
 * that would need them rather than offering one that could only fail.
 *
 * Recordings are the exception that became possible: one somebody put on
 * YouTube is on the internet rather than on a disk, so a browser can play it
 * — on a page of its own, with the markers the desktop captured beneath it.
 */
export function createWebPlatform({
  api,
  navigate
}: {
  api: ServerApi
  /** Goes to a path within the web client, as the router does. */
  navigate: (path: string) => void
}): Platform {
  return {
    kind: 'web',

    copyText: (text) => navigator.clipboard.writeText(text),

    // A page of its own here, rather than the desktop's separate window.
    openLpEditor: ({ account, queueType, matchId }) =>
      navigate(paths.lpEditor(account, { queue: rankQueueParam(queueType), match: matchId })),

    // Only ever the row's own player's recording: the server puts one on a row
    // for the account whose history it is, and the page asks for that pair.
    watchRecording: ({ account, match }) => navigate(paths.recording(account, match.matchId)),

    youtube: createWebYouTubeMount(),

    // The server hands out a URL signed for a quarter of an hour, and the
    // browser downloads from the blob store directly. That URL must be https
    // for a page served over https to follow it — see BLOB_PUBLIC_URL.
    downloadReplay: async (matchId) => {
      try {
        const grant = await api.replays.downloadGrant(matchId)
        window.location.assign(grant.downloadUrl)
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'That replay could not be downloaded from the server.'
        }
      }
    },

    statsDbImport: {
      pick: pickStatsDb,
      run: (source, onProgress) => importStatsDbFile(source as File, api.importer, onProgress)
    }
  }
}
