/**
 * Reading a .rofl without asking Riot anything.
 *
 * A replay file carries a JSON blob describing the game it recorded: how long
 * it ran and a full scoreboard — ten players, their champions, their KDA, their
 * items. Alongside it, the container records which build of the game produced
 * the file. Both matter here. The build decides which client can play the file
 * back, and it is the only place that answer exists for a replay whose match
 * never synced; the scoreboard is what lets a file somebody renamed still find
 * its match.
 *
 * Riot has shipped two containers behind the same `RIOT` magic, and they keep
 * these two things in different places:
 *
 *   v1 (`RIOT\0\0`)  — an offset table after a 256-byte signature points at a
 *                      metadata blob near the front. The blob carries
 *                      `gameVersion`.
 *   v2 (`RIOT\2\0`)  — the version is a length-prefixed string in the first
 *                      thirty bytes, the payload is zstd-compressed, and the
 *                      metadata blob sits at the *end* of the file with no
 *                      `gameVersion` in it at all.
 *
 * So the version is read from the header when the container offers it there,
 * and the metadata is looked for in three places in decreasing order of
 * confidence: where the offset table says, at the end, and at the front. A file
 * that answers none of that still parses to whatever was recovered — losing the
 * patch to a format change is a bad day, losing the replay would be a bug.
 */

/** One player as the replay file describes them. Every field is optional: this is Riot's blob, not ours. */
export interface RoflPlayer {
  name: string | null
  championName: string | null
  kills: number | null
  deaths: number | null
  assists: number | null
  items: number[]
  win: boolean | null
}

export interface RoflHeader {
  /** e.g. "16.16.804.9184". Null when neither the header nor the blob carried one. */
  gameVersion: string | null
  durationSeconds: number | null
  players: RoflPlayer[]
}

const MAGIC = 'RIOT'

/**
 * v1's layout: a 4-byte magic, two bytes of format, a 256-byte signature, and
 * then an offset table. Only the metadata window is read — the payload is the
 * replay itself and is of no interest to us.
 */
const SIGNATURE_END = 6 + 256
const METADATA_OFFSET = SIGNATURE_END + 6
const METADATA_LENGTH = SIGNATURE_END + 10
const MIN_V1_HEADER_BYTES = SIGNATURE_END + 22

/**
 * v2 writes the version as a Pascal-style string: one length byte, then that
 * many ASCII characters. It sits immediately after the magic and an eight-byte
 * identifier.
 */
const V2_VERSION_LENGTH_AT = 14
/** Longer than any version Riot has shipped; a bigger byte means this is not that field. */
const MAX_VERSION_BYTES = 32

/**
 * How much of each end of the file to read.
 *
 * v2's metadata blob has been observed around 120 KB and runs to the last byte,
 * so a megabyte of tail clears it comfortably while staying a rounding error
 * against a 13 MB replay.
 */
export const HEAD_READ_BYTES = 256 * 1024
export const TAIL_READ_BYTES = 1024 * 1024

/**
 * `tail` defaults to `head` so a small file — or a test fixture — can be passed
 * as one buffer without the caller having to think about it.
 */
export function parseRoflHeader(head: Uint8Array, tail: Uint8Array = head): RoflHeader | null {
  if (head.length < 8) return null

  // The magic is checked because a file that is not a replay at all should be
  // rejected outright. The two bytes after it are not, because that is the part
  // that moves, and a third container should degrade rather than be refused.
  if (Buffer.from(head.subarray(0, 4)).toString('latin1') !== MAGIC) return null

  const metadata = readByOffsets(head) ?? scanForMetadata(tail) ?? scanForMetadata(head)

  // A v2 file whose metadata we could not reach still knows its own patch, and
  // that alone is enough to tell the user which client they need.
  const headerVersion = readVersionFromHeader(head)
  if (metadata === null) {
    return headerVersion === null
      ? null
      : { gameVersion: headerVersion, durationSeconds: null, players: [] }
  }

  return {
    gameVersion: headerVersion ?? str(metadata['gameVersion']),
    durationSeconds: durationOf(metadata['gameLength']),
    players: playersOf(metadata['statsJson'])
  }
}

/**
 * The length-prefixed version string v2 puts in its header.
 *
 * Validated rather than trusted: byte 14 is only a length in this container,
 * and in v1 it is part of the signature, where it will usually be nonsense.
 * Requiring the result to look like a version keeps a v1 file from picking up a
 * garbage patch that would then be matched against installed clients.
 */
function readVersionFromHeader(head: Uint8Array): string | null {
  if (head.length <= V2_VERSION_LENGTH_AT) return null

  const length = head[V2_VERSION_LENGTH_AT]
  if (length === undefined || length === 0 || length > MAX_VERSION_BYTES) return null

  const start = V2_VERSION_LENGTH_AT + 1
  if (start + length > head.length) return null

  const text = Buffer.from(head.subarray(start, start + length)).toString('latin1')
  return /^\d+\.\d+(\.\d+)*$/.test(text) ? text : null
}

/** v1's documented path: trust the offset table, but never past the end of what we read. */
function readByOffsets(head: Uint8Array): Record<string, unknown> | null {
  if (head.length < MIN_V1_HEADER_BYTES) return null

  const view = Buffer.from(head.buffer, head.byteOffset, head.byteLength)
  const offset = view.readUInt32LE(METADATA_OFFSET)
  const length = view.readUInt32LE(METADATA_LENGTH)

  if (length === 0 || offset + length > head.length) return null

  return parseJsonObject(Buffer.from(head.subarray(offset, offset + length)).toString('utf8'))
}

/**
 * Find the blob by looking for it.
 *
 * Every metadata blob Riot has written contains "gameLength", so the object can
 * be located without knowing where the container put it. Searching from the end
 * rather than the start is what makes this work for v2, where the blob is the
 * last thing in the file; from the anchor the enclosing object is recovered by
 * walking back to its opening brace and forward with a brace counter.
 */
function scanForMetadata(bytes: Uint8Array): Record<string, unknown> | null {
  const text = Buffer.from(bytes).toString('utf8')
  const anchor = text.lastIndexOf('"gameLength"')
  if (anchor === -1) return null

  const start = text.lastIndexOf('{', anchor)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === String.fromCharCode(92)) {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return parseJsonObject(text.slice(start, i + 1))
    }
  }

  return null
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** gameLength is milliseconds. Guard the absurd rather than the merely unexpected. */
function durationOf(raw: unknown): number | null {
  const ms = num(raw)
  if (ms === null || ms <= 0) return null
  return Math.round(ms / 1000)
}

/**
 * The scoreboard arrives as a *string* of JSON nested inside the metadata JSON,
 * and every value inside it is a string too — "7", not 7. That is Riot's doing,
 * not a bug here.
 */
function playersOf(raw: unknown): RoflPlayer[] {
  if (typeof raw !== 'string') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed.filter(isRecord).map(toPlayer)
}

function toPlayer(row: Record<string, unknown>): RoflPlayer {
  const items: number[] = []
  for (let slot = 0; slot <= 6; slot++) {
    const item = num(row[`ITEM${slot}`])
    if (item !== null && item > 0) items.push(item)
  }

  return {
    // v2 leaves NAME empty and puts the player's handle in RIOT_ID_GAME_NAME;
    // v1 filled NAME. Preferring the Riot ID covers both.
    name: str(row['RIOT_ID_GAME_NAME']) ?? str(row['NAME']),
    championName: str(row['SKIN']),
    kills: num(row['CHAMPIONS_KILLED']) ?? 0,
    deaths: num(row['NUM_DEATHS']) ?? 0,
    assists: num(row['ASSISTS']) ?? 0,
    items,
    win: winOf(row['WIN'])
  }
}

/** "Win" / "Fail" in some builds, "1" / "0" in others. */
function winOf(raw: unknown): boolean | null {
  const text = str(raw)
  if (text === null) return null
  if (/^win$/i.test(text) || text === '1') return true
  if (/^fail$/i.test(text) || text === '0') return false
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
