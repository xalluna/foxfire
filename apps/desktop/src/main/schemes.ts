import { protocol } from 'electron'
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
 *
 * A recording on the server needs no scheme of ours: it plays in Foxfire
 * Media's own page, framed through the server's relay — see media/embedHeaders.ts.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RECORDING_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}
