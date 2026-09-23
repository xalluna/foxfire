import { protocol } from 'electron'
import { YOUTUBE_ENABLED } from '@shared/features'
import { YOUTUBE_HOST_SCHEME } from '@shared/youtubeHost'
import { RECORDING_SCHEME } from './recordingProtocol'

/**
 * Every scheme of our own, registered in the one call Electron allows.
 *
 * registerSchemesAsPrivileged may be called once, before the app is ready, and
 * a second call replaces the first rather than adding to it — so a new scheme
 * registered beside the recording one would quietly unregister it. They live
 * together here for that reason.
 *
 * - `recording` streams a video off disk to a <video>, so it needs to stream,
 *   and fetch, and to be a secure origin the renderer's CSP can name.
 * - `foxfire-youtube` is the page YouTube's player lives in. Standard and
 *   secure so it has a real origin of its own — which is the whole point of
 *   it: an origin the preload never runs in. See shared/youtubeHost.ts. Only
 *   in a build made with YouTube; without it the scheme does not exist.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RECORDING_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    },
    ...(YOUTUBE_ENABLED
      ? [
          {
            scheme: YOUTUBE_HOST_SCHEME,
            privileges: { standard: true, secure: true }
          }
        ]
      : [])
  ])
}
