import { basename, dirname, extname, join, relative, isAbsolute } from 'node:path'
import { GAMES, queueFolder, type GameId } from '@foxfire/core'

/*
 * Where a finished recording is filed, under the capture folder:
 *
 *   <capture folder>\<Riot ID>\<LoL | TFT>\<mode>\<YYYY-MM-DD HH-mm-ss>.mp4
 *
 * e.g. Videos\Foxfire\Faker-KR1\TFT\Ranked\2026-10-23 21-04-17.mp4. OBS writes
 * every recording into the folder itself, by its own name; the file is moved
 * here once it is closed. Recordings made before this rule stay where they are,
 * and so does anything recorded outside the folder.
 *
 * Pure, for testing: nothing here touches the disk.
 */

/** The names Windows keeps for devices, which no file or folder may take, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** Characters Windows refuses in a name, and the control characters, which it also refuses. */
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g

/** Long enough for any Riot ID and mode; well short of where Windows' path limit starts to matter. */
const MAX_SEGMENT = 64

/**
 * A name that Windows will take as one folder or file name.
 *
 * A Riot ID can hold characters Windows refuses (a tag line of "?" is legal on
 * Riot's side), end in a dot Windows silently drops, or spell a device name.
 * Each is made harmless rather than refused: the recording has to go
 * somewhere. An empty result falls back to the given name.
 */
export function sanitizeWindowsSegment(name: string, fallback = '_'): string {
  let safe = name.normalize('NFC').replace(INVALID, '_').trim()
  if (safe.length > MAX_SEGMENT) safe = safe.slice(0, MAX_SEGMENT)
  // Windows strips trailing dots and spaces, so "Faker." and "Faker" would be one folder.
  safe = safe.replace(/[. ]+$/, '')
  if (safe === '') return fallback
  return RESERVED.test(safe) ? `${safe}_` : safe
}

/**
 * The player's folder: their Riot ID as a link spells it, `Faker-KR1`.
 *
 * `riotId` is how a recording row stores it, `gameName#tagLine`. A recording
 * that never learnt whose it was goes under `Unknown`.
 */
export function accountFolder(riotId: string | null): string {
  if (!riotId) return 'Unknown'
  const hash = riotId.lastIndexOf('#')
  const slug = hash < 0 ? riotId : `${riotId.slice(0, hash)}-${riotId.slice(hash + 1)}`
  return sanitizeWindowsSegment(slug, 'Unknown')
}

/** `LoL` or `TFT`. */
export function gameFolder(game: GameId): string {
  return GAMES[game].folder
}

/** The mode's folder from the registry — `Solo-Duo`, `Ranked`, `Double-Up` — or `Other` for a queue nobody listed. */
export function modeFolder(game: GameId, queueId: number | null): string {
  return sanitizeWindowsSegment(queueFolder(game, queueId), 'Other')
}

/** `2026-10-23 21-04-17`, in this PC's own time, which is how somebody looking for last night's game thinks of it. */
export function recordingFileName(startedAt: number, extension: string): string {
  const d = new Date(startedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  return `${date} ${time}${extension}`
}

/** What a recording's place is worked out from: its row, and the file OBS wrote. */
export interface RecordingPlacement {
  root: string
  riotId: string | null
  game: GameId
  queueId: number | null
  startedAt: number
  /** The file OBS wrote, whose extension is kept. */
  sourcePath: string
}

export function plannedRecordingPath(placement: RecordingPlacement): string {
  return join(
    placement.root,
    accountFolder(placement.riotId),
    gameFolder(placement.game),
    modeFolder(placement.game, placement.queueId),
    recordingFileName(placement.startedAt, extname(placement.sourcePath))
  )
}

/**
 * The first of `path`, `name (2).ext`, `name (3).ext` … that is free.
 *
 * Two recordings can start in the same second — a crash and a restart — and
 * neither may overwrite the other.
 */
export function withCollisionSuffix(path: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(path)) return path

  const extension = extname(path)
  const stem = join(dirname(path), basename(path, extension))
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${extension}`
    if (!isTaken(candidate)) return candidate
  }
}

/** Whether a file sits somewhere under the folder — the only files this moves. */
export function isUnder(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The folders a file sat in that may now be empty, deepest first, stopping
 * short of the root itself — what is worth trying to remove once a recording's
 * file is deleted.
 */
export function foldersBetween(root: string, path: string): string[] {
  if (!isUnder(root, path)) return []
  const folders: string[] = []
  for (let dir = dirname(path); isUnder(root, dir); dir = dirname(dir)) folders.push(dir)
  return folders
}
