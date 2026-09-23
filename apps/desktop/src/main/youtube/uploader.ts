import type { FileHandle } from 'node:fs/promises'
import type { YouTubePrivacy } from '@shared/types'
import { insertMetadata, nextChunk, offsetFromRange, UPLOAD_ENDPOINT } from './resumable'

/**
 * The HTTP half of YouTube's resumable upload. The rules are in resumable.ts;
 * this only sends what they say to.
 */

/** What YouTube answers the last chunk with: the video, as it now exists. */
export interface UploadedVideo {
  id: string
  status?: { privacyStatus?: string; uploadStatus?: string }
}

/** YouTube answered, and not with success. The body is kept for classifyYouTubeError. */
export class YouTubeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(`YouTube answered ${status}`)
    this.name = 'YouTubeHttpError'
  }
}

async function failure(response: Response): Promise<YouTubeHttpError> {
  const body: unknown = await response.json().catch(() => null)
  return new YouTubeHttpError(response.status, body)
}

/** Opens a session: the video's details go up first, and YouTube says where the bytes go. */
export async function startSession(
  token: string,
  video: { title: string; description: string; privacy: YouTubePrivacy },
  totalBytes: number,
  signal?: AbortSignal
): Promise<string> {
  const params = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status' })
  const response = await fetch(`${UPLOAD_ENDPOINT}?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(totalBytes),
      'X-Upload-Content-Type': 'video/mp4'
    },
    body: JSON.stringify(insertMetadata(video)),
    signal
  })

  const location = response.headers.get('location')
  if (!response.ok || !location) throw await failure(response)
  return location
}

export type ChunkResult = { done: UploadedVideo } | { offset: number }

async function read(response: Response): Promise<ChunkResult> {
  // 308 is "resume incomplete": carry on from what the Range says arrived.
  if (response.status === 308) return { offset: offsetFromRange(response.headers.get('range')) }
  if (response.status === 200 || response.status === 201) return { done: (await response.json()) as UploadedVideo }
  throw await failure(response)
}

/**
 * Asks a session how much of the file it has.
 *
 * What makes an upload survive a restart: the offset saved locally is only
 * the last one confirmed, and YouTube may have more — or, if the session was
 * finished by a request whose answer never arrived, the whole video.
 */
export async function queryOffset(
  token: string,
  sessionUri: string,
  totalBytes: number,
  signal?: AbortSignal
): Promise<ChunkResult> {
  const response = await fetch(sessionUri, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': '0',
      'Content-Range': `bytes */${totalBytes}`
    },
    signal
  })
  return read(response)
}

/** Sends the chunk starting at `offset`, read from the open file. */
export async function putChunk(
  token: string,
  sessionUri: string,
  file: FileHandle,
  offset: number,
  totalBytes: number,
  signal?: AbortSignal
): Promise<ChunkResult> {
  const { start, end } = nextChunk(offset, totalBytes)
  const length = end - start + 1
  const buffer = Buffer.allocUnsafe(length)
  const { bytesRead } = await file.read(buffer, 0, length, start)
  if (bytesRead !== length) throw new Error('The recording file changed while it was being uploaded.')

  const response = await fetch(sessionUri, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': String(length),
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${totalBytes}`
    },
    body: buffer,
    signal
  })
  return read(response)
}
