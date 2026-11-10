import type { FileHandle } from 'node:fs/promises'
import { nextChunk, parseOffset, resolveLocation, TUS_VERSION, uploadMetadata } from './tusProtocol'

/**
 * The HTTP half of tus, and nothing else: every decision is in tusProtocol.ts
 * and the queue.
 *
 * Node's own fetch rather than Electron's net, deliberately. Foxfire Media
 * checks the Origin of a browser's upload against its application's origins,
 * and takes a request with none as server-to-server — which this is: the main
 * process, not a page. Node's fetch sends no Origin.
 *
 * The token is a bearer credential for this one upload. It goes in the header
 * and nowhere else — never a log line, never an error message.
 */

export class TusHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'TusHttpError'
  }
}

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'Tus-Resumable': TUS_VERSION, Authorization: `Bearer ${token}`, ...extra }
}

/** Creates the upload — spending the token — and answers with its address. */
export async function createUpload(
  endpoint: string,
  token: string,
  total: number,
  filename: string,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers(token, {
      'Upload-Length': String(total),
      'Upload-Metadata': uploadMetadata({ filename })
    }),
    signal
  })

  if (response.status !== 201) throw new TusHttpError(response.status, `Creating the upload failed (${response.status}).`)
  const location = resolveLocation(response.headers.get('Location'), endpoint)
  if (!location) throw new TusHttpError(0, 'The server made the upload but did not say where it is.')
  return location
}

/** How much of the file the upload has, as Foxfire Media counts it. */
export async function queryOffset(uploadUrl: string, token: string, signal: AbortSignal): Promise<number> {
  const response = await fetch(uploadUrl, { method: 'HEAD', headers: headers(token), signal })
  if (!response.ok) throw new TusHttpError(response.status, `Asking how far the upload got failed (${response.status}).`)
  const offset = parseOffset(response.headers.get('Upload-Offset'))
  if (offset === null) throw new TusHttpError(0, 'The server did not say how far the upload got.')
  return offset
}

/**
 * Sends one chunk from `offset`, read straight from the file, and answers with
 * the offset Foxfire Media confirms.
 *
 * A whole chunk in memory rather than a stream: fifty megabytes is nothing to
 * hold, and a body of known length is what a proxy in the way is happiest with.
 */
export async function sendChunk(
  uploadUrl: string,
  token: string,
  file: FileHandle,
  offset: number,
  total: number,
  signal: AbortSignal
): Promise<number> {
  const { start, length } = nextChunk(offset, total)
  const buffer = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const { bytesRead } = await file.read(buffer, read, length - read, start + read)
    if (bytesRead === 0) break
    read += bytesRead
  }
  if (read !== length) throw new TusHttpError(0, 'The file got shorter while it was being uploaded.')

  const response = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: headers(token, {
      'Upload-Offset': String(start),
      'Content-Type': 'application/offset+octet-stream'
    }),
    body: buffer,
    signal
  })

  if (response.status !== 204) throw new TusHttpError(response.status, `Sending part of the file failed (${response.status}).`)
  const confirmed = parseOffset(response.headers.get('Upload-Offset'))
  if (confirmed === null) throw new TusHttpError(0, 'The server did not say how much of the file arrived.')
  return confirmed
}
