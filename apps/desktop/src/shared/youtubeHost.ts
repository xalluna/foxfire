/**
 * The page that holds YouTube's player on the desktop, and how a recording
 * window talks to it.
 *
 * YouTube's player is driven by its IFrame API, a script from youtube.com. A
 * recording window has the preload's bridge to the main process on its
 * `window`, and Google's script running beside that bridge is exactly what
 * Electron's security checklist says never to do. So the script runs in a page
 * of its own, on a scheme of its own — a different origin, with no preload —
 * framed inside the recording window, and the two speak through postMessage
 * in the small vocabulary below and nothing else.
 *
 * Shared by main (which serves the page) and the renderer (which frames it).
 */

export const YOUTUBE_HOST_SCHEME = 'foxfire-youtube'

/** The host page's origin, which the renderer checks every message against. */
export const YOUTUBE_HOST_ORIGIN = `${YOUTUBE_HOST_SCHEME}://player`

/**
 * Who YouTube is told is embedding it.
 *
 * YouTube refuses to play for an embedder it cannot identify, and a page on a
 * custom scheme sends no Referer of its own. Its rules for a desktop app are
 * a fully qualified https URL built from the app's own identifier, which for
 * Foxfire is the appId NSIS stamps on the install — see electron-builder.yml.
 */
export const YOUTUBE_REFERER = 'https://com.brandonbarr.foxfire/'

/** Tags every message both ways, so neither side mistakes somebody else's postMessage for one. */
export const HOST_MESSAGE_TYPE = 'foxfire-yt'

export function youtubeHostUrl(videoId: string): string {
  return `${YOUTUBE_HOST_ORIGIN}/?v=${encodeURIComponent(videoId)}`
}

/** From the recording window to the host. */
export type HostCommand =
  | { type: typeof HOST_MESSAGE_TYPE; cmd: 'play' }
  | { type: typeof HOST_MESSAGE_TYPE; cmd: 'pause' }
  | { type: typeof HOST_MESSAGE_TYPE; cmd: 'seek'; seconds: number }

/** From the host to the recording window: the whole state, every time, so nothing depends on ordering. */
export interface HostSnapshot {
  type: typeof HOST_MESSAGE_TYPE
  ready: boolean
  playing: boolean
  currentTime: number
  duration: number
  /** The IFrame API's error code, or null while the video plays. */
  errorCode: number | null
}
