import type { YouTubePrivacy } from '@shared/types'

/**
 * The rules of YouTube's resumable upload protocol, apart from the I/O.
 *
 * A recording is gigabytes, uploaded from somebody's home connection, by an
 * app that pauses for every game and may be quit at any moment. The resumable
 * protocol is what makes that workable: a session is opened once with the
 * video's details, the bytes go up in chunks, and at any point the session can
 * be asked how much it has — so an upload carries on from where it got to
 * rather than starting again.
 */

export const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos'

/**
 * 8 MiB a request. YouTube requires chunks in multiples of 256 KiB, and this is
 * big enough that the per-request overhead does not matter, small enough that
 * pausing for a game or quitting loses little.
 */
export const CHUNK_BYTES = 8 * 1024 * 1024

/** YouTube's category for gaming. */
const GAMING_CATEGORY = '20'

/** The video resource sent when the session opens. */
export function insertMetadata(input: { title: string; description: string; privacy: YouTubePrivacy }): object {
  return {
    snippet: {
      title: input.title,
      description: input.description,
      categoryId: GAMING_CATEGORY
    },
    status: {
      privacyStatus: input.privacy,
      // Required, and always no: this is a video of a game played by an adult.
      selfDeclaredMadeForKids: false
    }
  }
}

/** The byte range of the next chunk, inclusive at both ends as Content-Range writes it. */
export function nextChunk(offset: number, total: number, size = CHUNK_BYTES): { start: number; end: number } {
  return { start: offset, end: Math.min(offset + size, total) - 1 }
}

/**
 * How many bytes YouTube has, from a 308's Range header.
 *
 * `bytes=0-524287` means the first 524,288 arrived, so the next one to send is
 * 524,288. No header at all means none arrived.
 */
export function offsetFromRange(range: string | null): number {
  const match = range ? /bytes=\d+-(\d+)/.exec(range) : null
  return match ? Number(match[1]) + 1 : 0
}

export type FailureKind =
  /** YouTube's daily quota is spent. Wait until it resets. */
  | 'quota'
  /** Something temporary: try again later, backing off. */
  | 'backoff'
  /** The access token was refused. Get a new one and try again. */
  | 'auth'
  /** The upload session is gone. Start a new one from the beginning. */
  | 'restart'
  /** Retrying will not help; somebody has to read this. */
  | 'fatal'

export interface Failure {
  kind: FailureKind
  message: string
}

interface GoogleErrorBody {
  error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> }
}

/**
 * What a failed request means for the upload.
 *
 * Mostly by YouTube's own reason code, because the status alone cannot tell a
 * spent quota from a channel that does not exist — both are 403.
 */
export function classifyYouTubeError(status: number, body: unknown): Failure {
  const error = (body as GoogleErrorBody | null)?.error
  const reason = error?.errors?.[0]?.reason ?? ''
  const detail = error?.message ?? error?.errors?.[0]?.message ?? `YouTube answered ${status}.`

  switch (reason) {
    case 'quotaExceeded':
    case 'dailyLimitExceeded':
      return {
        kind: 'quota',
        message: "Foxfire has used up today's YouTube uploads. It will carry on after midnight, Pacific time."
      }
    case 'uploadLimitExceeded':
      return {
        kind: 'quota',
        message: 'This YouTube channel has reached its upload limit for today. Foxfire will try again tomorrow.'
      }
    case 'rateLimitExceeded':
    case 'userRateLimitExceeded':
    case 'backendError':
      return { kind: 'backoff', message: 'YouTube asked Foxfire to slow down. It will try again shortly.' }
    case 'youtubeSignupRequired':
      return {
        kind: 'fatal',
        message: 'This Google account has no YouTube channel yet. Create one on youtube.com, then try again.'
      }
    case 'invalidTitle':
      return { kind: 'fatal', message: 'YouTube would not take that title. Keep it under 100 characters, without < or >.' }
    case 'invalidDescription':
      return {
        kind: 'fatal',
        message: 'YouTube would not take that description. Keep it under 5,000 bytes, without < or >.'
      }
  }

  if (status === 401) return { kind: 'auth', message: 'YouTube refused the sign-in.' }
  if (status === 404 || status === 410) {
    return { kind: 'restart', message: 'The upload session expired, so it starts again from the beginning.' }
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { kind: 'backoff', message: 'YouTube could not take the upload just now. Foxfire will try again shortly.' }
  }
  return { kind: 'fatal', message: detail }
}

/** A dropped connection, a DNS failure — anything that never reached YouTube. Always worth another try. */
export function networkFailure(): Failure {
  return { kind: 'backoff', message: 'YouTube could not be reached. Foxfire will try again shortly.' }
}

const BACKOFF_BASE_MS = 30_000
const BACKOFF_CAP_MS = 60 * 60_000

/**
 * How long to wait before attempt `attempt` (1 for the first retry).
 *
 * Doubling from thirty seconds to an hour, with a fifth either way of jitter so
 * a flaky evening does not retry in lockstep.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_MS)
  return Math.round(base * (0.8 + random() * 0.4))
}

/**
 * Whether YouTube kept the privacy that was asked for.
 *
 * Every upload from a Google project that has not passed YouTube's audit is
 * made private, whatever the uploader chose. Worth knowing, because it is why
 * nobody else on the server can watch it — and it is fixed by the audit, not
 * by uploading again.
 */
export function forcedPrivate(requested: YouTubePrivacy, returned: string | undefined): boolean {
  return requested !== 'private' && returned === 'private'
}
