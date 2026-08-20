import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { getDb } from './db'
import { getRecordingFilePath } from './db/repositories/recordings.repo'
import { getCaptureSettings } from './services/captureSettings'
import { createLogger } from './telemetry/logger'

/**
 * Serves recorded video to the recording window, over a scheme of our own.
 *
 * The renderer runs sandboxed with `default-src 'self'`, so it cannot open a
 * file:// URL, and relaxing the CSP to allow one would hand a compromised
 * window the ability to read any video on the machine by path. This scheme
 * takes a recording id instead: the path is looked up in the database and checked
 * to be inside the recording folder, so there is no path for the renderer to name.
 *
 * It also has to speak Range. Chromium seeks a <video> by asking for byte
 * ranges, and a handler that only ever returns the whole file leaves the
 * timeline able to move the playhead but not the picture.
 */
const log = createLogger('recordings')

export const RECORDING_SCHEME = 'recording'

/**
 * Registered before the app is ready, which is the only time Electron accepts
 * it. `stream: true` is what allows a Response body to be a stream rather than
 * a fully buffered blob — a 3GB recording cannot be buffered.
 */
export function registerRecordingScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RECORDING_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

/** The URL a recording window puts in its <video src>. */
export function recordingUrl(recordingId: number): string {
  return `${RECORDING_SCHEME}://media/${recordingId}`
}

/**
 * Resolves an id to a file inside the recording folder, or null.
 *
 * The containment check is the point: a path that has been edited in the
 * database, or a folder setting changed after the fact, must not be able to
 * serve something outside the folder the user pointed us at.
 */
function resolveRecordingFile(recordingId: number): string | null {
  const stored = getRecordingFilePath(getDb(), recordingId)
  if (!stored) return null

  const folder = getCaptureSettings().folder
  if (!folder) return null

  const file = resolve(stored)
  const root = resolve(folder)
  if (file !== root && !file.startsWith(root + sep)) {
    log.warn('Refused a recording outside the recording folder', { recordingId })
    return null
  }
  return file
}

/** `bytes=0-`, `bytes=500-999`, `bytes=-500`. Null when there is no usable range. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  let start: number
  let end: number

  if (rawStart === '') {
    if (rawEnd === '') return null
    // A suffix range: the last N bytes. Chromium uses this to find the moov
    // atom on a file that was written with it at the end.
    start = Math.max(0, size - Number(rawEnd))
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start, end }
}

function bodyFor(file: string, start: number, end: number): ReadableStream {
  // Readable.toWeb rather than reading into a Buffer: this range can be tens of
  // megabytes and there may be several recording windows open at once.
  return Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
}

/** Registered after the app is ready. */
export function registerRecordingProtocol(): void {
  protocol.handle(RECORDING_SCHEME, (request) => {
    const id = Number(new URL(request.url).pathname.replace(/^\//, ''))
    if (!Number.isInteger(id)) return new Response('Bad recording id', { status: 400 })

    const file = resolveRecordingFile(id)
    if (!file) return new Response('Not found', { status: 404 })

    let size: number
    try {
      size = statSync(file).size
    } catch {
      // Deleted from Explorer while a window had it open. The Recordings view
      // already reports the file as missing; this just avoids a hard crash.
      return new Response('Recording is no longer on disk', { status: 404 })
    }

    const range = parseRange(request.headers.get('range'), size)

    if (!range) {
      return new Response(bodyFor(file, 0, size - 1), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(size),
          // Without this Chromium assumes seeking is unsupported and disables
          // the scrub bar entirely.
          'Accept-Ranges': 'bytes'
        }
      })
    }

    return new Response(bodyFor(file, range.start, range.end), {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
