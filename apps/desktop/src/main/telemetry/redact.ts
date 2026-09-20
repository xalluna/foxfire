import { createHash } from 'node:crypto'

/**
 * The single gate every value passes through before it reaches a telemetry row
 * or a log line. Nothing writes to disk without going through here.
 *
 * The primary mechanism is a denylist on property *keys*, not a scan of values:
 * a value scan can only catch secrets whose shape you already know, whereas a
 * header called `X-Riot-Token` is dangerous no matter what it contains. The
 * `RGAPI-` scrub below is a second line of defence for the case that actually
 * bites — a key interpolated into a message or a URL, where it is no longer
 * sitting under a recognisable key at all.
 */

/** Redacted whenever one of these appears as a fragment of a property name. */
const DENY_FRAGMENTS = ['token', 'secret', 'password', 'passwd', 'apikey', 'authorization', 'cookie', 'credential']

/** Redacted on an exact (normalised) name match, where a fragment rule would over-reach. */
const DENY_EXACT = new Set(['key', 'auth', 'session'])

const REDACTED = '[redacted]'
const MAX_STRING = 500
const MAX_DEPTH = 6

/**
 * Riot personal and production keys are always `RGAPI-` followed by a UUID.
 * Catches the leak path a key denylist cannot: a key that has been formatted
 * into a string, such as a URL with the token in the query or an error message
 * built by a library that echoes the request.
 */
const RIOT_KEY_PATTERN = /RGAPI-[A-Za-z0-9-]+/g

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key)
  if (DENY_EXACT.has(normalised)) return true
  return DENY_FRAGMENTS.some((fragment) => normalised.includes(fragment))
}

export function scrubString(value: string): string {
  const scrubbed = value.replace(RIOT_KEY_PATTERN, REDACTED)
  return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed
}

/**
 * A per-install salt, so identifiers cannot be recovered by hashing a guess.
 *
 * PUUIDs are high-entropy enough that a bare hash would be safe, but match IDs
 * (`NA1_5327…`) sit in a small enough space to be enumerated. Injected rather
 * than read from the database directly so this module stays usable in tests
 * without Electron or a file on disk.
 */
let hashSalt = 'unsalted'

export function setHashSalt(salt: string): void {
  hashSalt = salt
}

/**
 * Stable, truncated, one-way. Two rows that hit the same match share a hash, so
 * you can still see "these three attempts were the same request" without the
 * identifier being recoverable by whoever reads the file.
 */
export function hashId(value: string): string {
  return createHash('sha256').update(hashSalt).update(value).digest('hex').slice(0, 16)
}

/**
 * Deep-redacts an arbitrary value for storage as JSON.
 *
 * Cycles and depth are both bounded: telemetry is frequently handed Error
 * objects, and an Error thrown by fetch can carry a `cause` chain that
 * eventually references a request object holding the very header this module
 * exists to keep out of the file.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') return scrubString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return undefined

  if (value instanceof Error) return redactError(value, depth, seen)

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    if (depth >= MAX_DEPTH) return '[depth]'
    seen.add(value)

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => redact(item, depth + 1, seen))
    }

    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED
        continue
      }
      // Properties are read one at a time inside a guard because a throwing
      // getter must not take the whole redaction with it. Most of what reaches
      // this module is an Error on a failure path, and throwing from inside
      // error handling turns a logged problem into an unlogged crash.
      try {
        out[key] = redact((value as Record<string, unknown>)[key], depth + 1, seen)
      } catch {
        out[key] = '[unreadable]'
      }
    }
    return out
  }

  return undefined
}

function redactError(err: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: scrubString(err.message)
  }
  // Deliberately no stack: it is large, it is rarely the useful part once the
  // message and the endpoint are known, and it can quote source lines.
  const cause = (err as { cause?: unknown }).cause
  if (cause !== undefined && depth < MAX_DEPTH) {
    out.cause = redact(cause, depth + 1, seen)
  }
  // RiotApiError carries a status worth keeping.
  const status = (err as { status?: unknown }).status
  if (typeof status === 'number') out.status = status
  return out
}

/** Flattens any thrown value into the two columns riot_requests stores. */
export function describeError(err: unknown): { kind: string; message: string } {
  if (err instanceof Error) {
    return { kind: err.name || 'Error', message: scrubString(err.message) }
  }
  return { kind: typeof err, message: scrubString(String(err)) }
}

export function redactJson(value: unknown): string | null {
  try {
    const redacted = redact(value)
    return redacted === undefined ? null : JSON.stringify(redacted)
  } catch {
    return null
  }
}
