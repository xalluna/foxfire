/**
 * The tus 1.0 rules the uploader follows, pure so they are tested without a
 * network.
 *
 * Foxfire Media takes files over tus: create the upload with its length (a
 * POST, which spends the one-time token), then send it in PATCHes from the
 * offset the server confirms, and after any interruption ask it (a HEAD) how
 * far it got. The same token is good for HEAD and PATCH on that one upload for
 * as long as the upload is alive — and it stays alive only while bytes keep
 * arriving: ten minutes without any, or twelve hours in all, and Foxfire Media
 * fails it and drops what it had.
 */

export const TUS_VERSION = '1.0.0'

/**
 * Bytes per PATCH. Foxfire Media's own console sends 50 MB and says to keep to
 * that behind a proxy with a body-size limit, Cloudflare's among them. A chunk
 * is also the most that is resent after a dropped connection.
 */
export const CHUNK_BYTES = 50 * 1024 * 1024

/** The `Upload-Metadata` header: comma-separated `key base64(value)` pairs. */
export function uploadMetadata(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',')
}

/** The offset a HEAD or PATCH answered with, or null when it gave none worth trusting. */
export function parseOffset(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null
  const offset = Number(header.trim())
  return Number.isSafeInteger(offset) ? offset : null
}

/** The next PATCH: where it starts and how long it is. */
export function nextChunk(offset: number, total: number, chunk = CHUNK_BYTES): { start: number; length: number } {
  return { start: offset, length: Math.max(0, Math.min(chunk, total - offset)) }
}

/**
 * The upload's own address, from a creation's `Location` — which tus allows to
 * be relative to the endpoint it was created at.
 */
export function resolveLocation(location: string | null, endpoint: string): string | null {
  if (!location) return null
  try {
    return new URL(location, endpoint).href
  } catch {
    return null
  }
}

/** What to do about a failed request. */
export type TusFailure =
  /** The token is spent or the upload is gone: ask the server for a new token and start again. */
  | { kind: 'renew'; message: string }
  /** The offset was wrong: ask Foxfire Media where it is and carry on from there. */
  | { kind: 'requery'; message: string }
  /** Foxfire Media's disk is full. Nothing will go until its host makes room. */
  | { kind: 'full'; message: string }
  /** A network blip, or the server having a bad minute: wait and try again. */
  | { kind: 'backoff'; message: string }
  /** Will never work as asked: a file too big, a request refused as wrong. */
  | { kind: 'fatal'; message: string }

/**
 * Sorts a tus answer that was not a success.
 *
 * Creation and the rest differ on 401 and 404. Creating with a token Foxfire
 * Media refuses (401) means it was spent or lapsed — a new one fixes it. A HEAD
 * or PATCH answered 404 means the upload itself is gone, failed for going idle
 * or for running past its twelve hours — a new one fixes that too, from the
 * start. A 403 is an origin refused, which no retry changes.
 */
export function classifyTusStatus(status: number, phase: 'create' | 'resume'): TusFailure {
  if (status === 401 || (phase === 'resume' && (status === 404 || status === 410))) {
    return { kind: 'renew', message: 'The upload has to start again: its token was spent or the server let it go.' }
  }
  if (status === 409) return { kind: 'requery', message: 'The server and this PC disagreed about how much had arrived.' }
  if (status === 413) return { kind: 'fatal', message: 'The file is bigger than the server takes.' }
  if (status === 507) return { kind: 'full', message: "The server's video storage is full. Its host has to make room." }
  if (status === 403) return { kind: 'fatal', message: 'The server refused this upload.' }
  if (status === 429 || status >= 500 || status === 0) {
    return { kind: 'backoff', message: `The server had trouble (${status}); trying again shortly.` }
  }
  return { kind: 'fatal', message: `The upload was refused (${status}).` }
}

export function networkFailure(): TusFailure {
  return { kind: 'backoff', message: 'Could not reach the server; trying again shortly.' }
}

const BACKOFF_BASE_MS = 30_000
const BACKOFF_CAP_MS = 60 * 60_000

/**
 * How long to wait before attempt `attempt` (1-based): thirty seconds,
 * doubling, at most an hour, with a fifth either way so a dozen PCs on one
 * server's outage do not all come back on the same second.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_MS)
  return Math.round(base * (0.8 + random() * 0.4))
}

/**
 * The rate, from the last few seconds' progress: what an ETA is worked out
 * from. A sample older than the window drops out, so a pause for a game does
 * not drag the figure down for the rest of the afternoon.
 */
export function rateFrom(
  samples: ReadonlyArray<{ at: number; bytes: number }>,
  now: number,
  windowMs = 30_000
): number | null {
  const recent = samples.filter((sample) => now - sample.at <= windowMs)
  if (recent.length < 2) return null
  const first = recent[0]!
  const last = recent[recent.length - 1]!
  const seconds = (last.at - first.at) / 1000
  if (seconds <= 0) return null
  const rate = (last.bytes - first.bytes) / seconds
  return rate > 0 ? rate : null
}
