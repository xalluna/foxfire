import { shell } from 'electron'
import { copyFileSync, mkdirSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { accountContext } from '../api/accountContext'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import { HEAD_READ_BYTES, TAIL_READ_BYTES, parseRoflHeader, type RoflHeader } from '../rofl/header'
import { copyFileName, gameIdFromMatchId, matchIdFromRoflName } from '../rofl/filename'
import { findMatchForReplay, type FingerprintCandidate } from '../rofl/fingerprint'
import { patchFromGameVersion, replayBlockedReason, runnerFor } from '../rofl/patch'
import { launchReplay as launchRoflReplay, type LaunchOutcome } from '../rofl/launch'
import { getArchivePatches } from '../db/repositories/clientArchives.repo'
import {
  createReplay,
  getClaimedMatchIds,
  getKnownSourcePaths,
  getReplay,
  getReplayFilePath,
  getReplays,
  getUnownedReplays,
  getUsage,
  setReplayAccount,
  setReplayMatch,
  softDeleteReplay
} from '../db/repositories/replays.repo'
import { getRoflSettings } from './roflSettings'
import { resolveLiveClient, resolveSourceFolder } from './clientArchiveService'
import type { Replay, ReplayDiskUsage, ReplayImportProgress } from '@shared/types'

/**
 * Riot's replays, from the folder they land in to the client that plays them.
 *
 * The shape of this file is much simpler than its recording counterpart, and
 * deliberately so. A recording has to work out which match it belongs to from a
 * roster and a clock; a replay is named after its match, so ingest reads a
 * filename and the link is done. What is left is copying, remembering, and
 * knowing which client can still play what.
 */

const log = createLogger('rofl')

export function broadcastReplaysChanged(): void {
  broadcast(CH.replays.changed)
}

function broadcastImportProgress(progress: ReplayImportProgress): void {
  broadcast(CH.replays.importProgress, progress)
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every replay for one account, each told whether it can actually be watched.
 *
 * The playability check happens here rather than in the repository because it
 * depends on which clients are installed at this moment, which is not something
 * the database knows or should be told.
 */
export async function listReplays(accountId: string): Promise<Replay[]> {
  const db = getDb()
  const replays = getReplays(db, await accountContext(accountId))
  if (replays.length === 0) return replays

  const archives = getArchivePatches(db)
  const live = await resolveLiveClient()

  return replays.map((replay) => ({
    ...replay,
    blockedReason: replay.fileExists
      ? replayBlockedReason(replay.patch, runnerFor(replay.patch, archives, live.patch, live.path))
      : 'Foxfire can no longer find this file'
  }))
}

export async function getReplayUsage(accountId: string): Promise<ReplayDiskUsage> {
  const usage = getUsage(getDb(), await accountContext(accountId))
  // Reuses the list rather than re-deriving playability: both answers come from
  // the same per-row check, and the live client's patch is cached behind it.
  const replays = await listReplays(accountId)

  return {
    ...usage,
    missingCount: replays.filter((replay) => !replay.fileExists).length,
    unplayableCount: replays.filter((replay) => replay.fileExists && replay.blockedReason !== null)
      .length,
    softCapBytes: getRoflSettings().softCapBytes
  }
}

/* -------------------------------------------------------------------------- */
/* Watching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Opens a replay in the League client.
 *
 * Foxfire's own copy is the one handed over, never Riot's original — ours is
 * the file we know still exists.
 */
export async function openReplay(replayId: number): Promise<LaunchOutcome> {
  const db = getDb()
  const replay = getReplay(db, replayId)
  const filePath = getReplayFilePath(db, replayId)

  if (replay === null || filePath === null) {
    return { ok: false, reason: 'That replay is no longer listed.', attemptedCommand: null }
  }
  if (!replay.fileExists) {
    return { ok: false, reason: 'Foxfire can no longer find this file.', attemptedCommand: null }
  }

  const live = await resolveLiveClient()
  const runner = runnerFor(replay.patch, getArchivePatches(db), live.patch, live.path)
  const blocked = replayBlockedReason(replay.patch, runner)

  if (runner === null) {
    return { ok: false, reason: blocked ?? 'This replay cannot be played.', attemptedCommand: null }
  }

  return launchRoflReplay({
    filePath,
    // The filename is the fallback because an unlinked replay still has Riot's
    // name on it, which carries the same id the match would have given us.
    gameId: gameIdFromMatchId(replay.matchId ?? matchIdFromRoflName(basename(filePath))),
    runner,
    restoreToRiotFolder: () => restoreToRiotFolder(filePath, replay.matchId)
  })
}

/**
 * Puts Foxfire's copy back where the League client looks.
 *
 * The client plays out of its own replay folder and nowhere else, so a replay
 * it has since cleaned up cannot be watched however carefully we kept it —
 * unless it goes back. This is the one moment the copies pay for themselves,
 * and it is a copy rather than a move: Foxfire's own record stays intact.
 */
async function restoreToRiotFolder(filePath: string, matchId: string | null): Promise<string | null> {
  const source = await resolveSourceFolder(getRoflSettings().sourceFolder)
  if (source === null) return null

  const destination = join(source, copyFileName(matchId, basename(filePath)))

  try {
    mkdirSync(source, { recursive: true })
    copyFileSync(filePath, destination)
    log.info('Restored a replay into the League folder', { destination })
    return destination
  } catch (err) {
    log.warn('Could not restore a replay into the League folder', {
      destination,
      error: String(err)
    })
    return null
  }
}

export function revealReplay(replayId: number): void {
  const filePath = getReplayFilePath(getDb(), replayId)
  if (filePath !== null) shell.showItemInFolder(filePath)
}

/* -------------------------------------------------------------------------- */
/* Deleting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Removes Foxfire's copy and remembers that it was removed.
 *
 * The row survives as a tombstone. Without it the next folder scan would find
 * Riot's original still sitting there, conclude it had never been seen, and
 * import it straight back — a delete button that undoes itself.
 *
 * Riot's original is never touched. Foxfire did not put it there.
 */
export function removeReplay(replayId: number): void {
  const db = getDb()
  const filePath = getReplayFilePath(db, replayId)

  if (filePath !== null) {
    try {
      rmSync(filePath, { force: true })
    } catch (err) {
      // A file open in the client cannot be removed on Windows. The tombstone
      // still goes down: the user asked for it gone from the list, and leaving
      // the row live would only make the button look broken.
      log.debug('Could not delete a replay copy', { replayId, error: String(err) })
    }
  }

  softDeleteReplay(db, replayId, Date.now())
  broadcastReplaysChanged()
}

/* -------------------------------------------------------------------------- */
/* Ingest                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Reads both ends of the file and nothing in between.
 *
 * Both ends, because the two containers Riot ships disagree about where the
 * interesting parts live: the older one puts its metadata near the front, the
 * current one puts the patch in the first thirty bytes and the metadata in the
 * last hundred kilobytes. The megabytes between are the compressed replay
 * itself, which is of no use to us and is most of the file.
 */
function readHeader(filePath: string, size: number): RoflHeader | null {
  let fd: number | null = null
  try {
    fd = openSync(filePath, 'r')

    const headWanted = Math.min(HEAD_READ_BYTES, size)
    const headBuffer = Buffer.alloc(headWanted)
    const headRead = readSync(fd, headBuffer, 0, headWanted, 0)
    const head = headBuffer.subarray(0, headRead)

    // A file small enough that the two windows would overlap is read once.
    if (size <= HEAD_READ_BYTES) return parseRoflHeader(head)

    const tailWanted = Math.min(TAIL_READ_BYTES, size - headRead)
    const tailBuffer = Buffer.alloc(tailWanted)
    const tailRead = readSync(fd, tailBuffer, 0, tailWanted, size - tailWanted)

    return parseRoflHeader(head, tailBuffer.subarray(0, tailRead))
  } catch (err) {
    log.debug('Could not read a replay header', { filePath, error: String(err) })
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Nothing useful to do about a failed close.
      }
    }
  }
}

/**
 * Takes one .rofl into Foxfire's own storage.
 *
 * Returns null when the file is not ready. A .rofl grows on disk while the
 * client downloads it, and a partial file has no readable header — so the
 * header parse doubles as the "finished writing" check, and an unready file is
 * simply picked up by a later scan. This is why there is no settle timer.
 *
 * A header that cannot be read at all is not the same thing. That file is
 * ingested anyway, with an unknown patch, because losing the replay to a format
 * change would be far worse than losing the ability to say which client plays
 * it.
 */
export function ingestReplay(sourcePath: string, options: { copy?: boolean } = {}): number | null {
  const db = getDb()
  const settings = getRoflSettings()
  const folder = settings.folder
  if (folder === null) return null

  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(sourcePath)
  } catch {
    return null
  }
  if (!stats.isFile() || stats.size === 0) return null

  const name = basename(sourcePath)
  const header = readHeader(sourcePath, stats.size)

  // A file with neither a readable header nor a Riot-shaped name is either
  // still downloading or not a replay. Either way it is not ours to keep.
  const matchIdFromName = matchIdFromRoflName(name)
  if (header === null && matchIdFromName === null) return null

  const matchId = matchIdFromName ?? fingerprintMatch(db, header)

  try {
    mkdirSync(folder, { recursive: true })
  } catch (err) {
    log.warn('Could not create the replay folder', { folder, error: String(err) })
    return null
  }

  const destination = uniqueDestination(folder, copyFileName(matchId, name))

  try {
    if (options.copy === false) {
      // Manual adds of a file already inside our folder: nothing to copy.
    } else {
      copyFileSync(sourcePath, destination)
    }
  } catch (err) {
    log.warn('Could not copy a replay', { sourcePath, error: String(err) })
    return null
  }

  const filePath = options.copy === false ? sourcePath : destination

  // The header is the only source that works for a replay whose match has not
  // synced, so it is tried first. Riot's stored match carries the same number
  // in info.gameVersion, though, which makes it a free second opinion — and the
  // thing that keeps this feature working the next time the container changes.
  const patch = (header === null ? null : patchOf(header)) ?? patchFromMatch(db, matchId)

  const id = createReplay(db, {
    matchId,
    accountId: matchId === null ? null : accountForMatch(db, matchId),
    filePath,
    sourcePath,
    fileBytes: stats.size,
    gameVersion: header?.gameVersion ?? null,
    patch,
    durationSeconds: header?.durationSeconds ?? null,
    // The file's own timestamp, which for a client-written replay is when the
    // game ended. Only ever a display and sort key — the match, once linked,
    // carries the authoritative time.
    recordedAt: stats.mtimeMs
  })

  log.info('Ingested a replay', { id, matchId, patch })
  return id
}

function patchOf(header: RoflHeader): string | null {
  return patchFromGameVersion(header.gameVersion)
}

/**
 * The patch according to the match this replay belongs to.
 *
 * `info.gameVersion` is not a column — it survives inside the stored payload,
 * which is passthrough-parsed — so it is dug out with json_extract, the same
 * way several migrations already mine that column.
 */
function patchFromMatch(db: ReturnType<typeof getDb>, matchId: string | null): string | null {
  if (matchId === null) return null

  const row = db
    .prepare("SELECT json_extract(raw_json, '$.info.gameVersion') AS version FROM matches WHERE match_id = ?")
    .get(matchId) as { version: string | null } | undefined

  return patchFromGameVersion(row?.version ?? null)
}

/** Never overwrite: two games can produce the same stem once a file is renamed. */
function uniqueDestination(folder: string, fileName: string): string {
  const candidate = join(folder, fileName)
  try {
    statSync(candidate)
  } catch {
    return candidate
  }
  return join(folder, `${fileName.replace(/\.rofl$/i, '')}-${Date.now()}.rofl`)
}

/**
 * The fallback for a file whose name tells us nothing.
 *
 * Only reached by a manual add of a renamed file — every replay the watcher
 * finds still carries Riot's name. The header's scoreboard is compared against
 * stored matches; anything already claimed is skipped so two files cannot take
 * the same game.
 */
function fingerprintMatch(db: ReturnType<typeof getDb>, header: RoflHeader | null): string | null {
  if (header === null || header.players.length === 0) return null

  const claimed = getClaimedMatchIds(db)
  const rows = db
    .prepare(
      `SELECT m.match_id AS matchId, m.game_duration AS gameDuration,
              group_concat(p.champion_name) AS champions
         FROM matches m
         JOIN match_participants p ON p.match_id = m.match_id
        GROUP BY m.match_id`
    )
    .all() as unknown as Array<{ matchId: string; gameDuration: number; champions: string | null }>

  const candidates: FingerprintCandidate[] = rows.map((row) => ({
    matchId: row.matchId,
    gameDuration: row.gameDuration,
    championNames: row.champions === null ? [] : row.champions.split(','),
    taken: claimed.has(row.matchId)
  }))

  const championNames = header.players
    .map((player) => player.championName)
    .filter((name): name is string => name !== null)

  const found = findMatchForReplay({ championNames, durationSeconds: header.durationSeconds }, candidates)
  if (found === null) return null

  log.info('Fingerprinted a renamed replay to a match', {
    matchId: found.matchId,
    confidence: found.confidence
  })
  return found.matchId
}

/** Which of our accounts played this match, if any of them did. */
function accountForMatch(db: ReturnType<typeof getDb>, matchId: string): string | null {
  const row = db
    .prepare(
      `SELECT a.id AS id
         FROM accounts a
         JOIN match_participants p ON p.puuid = a.puuid
        WHERE p.match_id = ?
        LIMIT 1`
    )
    .get(matchId) as { id: number } | undefined

  // Stringified on the way out: a replay row records the id the way every
  // other machine-local row does, so it survives the move to a server.
  return row === undefined ? null : String(row.id)
}

/**
 * Fills in ownership for replays whose match has since synced.
 *
 * Runs after every sync. Cheap — it touches only rows still missing an account,
 * and there are none of those once things have settled.
 */
export function resolveReplayOwners(): number {
  const db = getDb()
  let resolved = 0

  for (const replay of getUnownedReplays(db)) {
    const accountId = accountForMatch(db, replay.matchId)
    if (accountId !== null) {
      setReplayAccount(db, replay.id, accountId)
      resolved++
    }
  }

  if (resolved > 0) {
    log.info('Resolved replay owners after a sync', { resolved })
    broadcastReplaysChanged()
  }
  return resolved
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Walks Riot's folder and ingests anything new.
 *
 * Safe to run as often as anything cares to: known source paths are skipped,
 * and tombstones count as known, so a deleted replay stays deleted.
 */
export async function scanReplayFolder(options: { announce?: boolean } = {}): Promise<number> {
  const settings = getRoflSettings()
  if (!settings.enabled) {
    log.debug('Replay scan skipped: keeping replays is switched off')
    return 0
  }

  const source = await resolveSourceFolder(settings.sourceFolder)
  if (source === null) {
    // Worth a warning rather than a shrug. Finding no folder is the one outcome
    // that makes the whole feature do nothing at all, and it is indistinguishable
    // from working correctly unless it says so.
    log.warn('No replay folder found — nothing to watch', {
      override: settings.sourceFolder
    })
    return 0
  }

  let entries: string[]
  try {
    entries = await readdir(source)
  } catch (err) {
    log.debug('Could not read the replay folder', { source, error: String(err) })
    return 0
  }

  const known = getKnownSourcePaths(getDb())
  const pending = entries
    .filter((entry) => entry.toLowerCase().endsWith('.rofl'))
    .map((entry) => join(source, entry))
    .filter((path) => !known.has(path.toLowerCase()))

  log.info('Scanned the replay folder', {
    source,
    found: entries.length,
    rofls: entries.filter((entry) => entry.toLowerCase().endsWith('.rofl')).length,
    pending: pending.length
  })
  if (pending.length === 0) return 0

  const announce = options.announce === true

  let imported = 0
  for (const [index, path] of pending.entries()) {
    if (announce) {
      broadcastImportProgress({ current: index + 1, total: pending.length, done: false })
    }
    if (ingestReplay(path) !== null) imported++
  }

  if (announce) broadcastImportProgress({ current: pending.length, total: pending.length, done: true })
  if (imported > 0) broadcastReplaysChanged()

  return imported
}

/**
 * Adds a file the user picked themselves.
 *
 * Reported rather than silent, unlike the watcher: the user just chose this
 * file and deserves to know whether it landed and whether it found its game.
 */
export function addReplayByPath(sourcePath: string): { ok: boolean; replay: Replay | null } {
  const id = ingestReplay(sourcePath)
  if (id === null) return { ok: false, replay: null }

  broadcastReplaysChanged()
  return { ok: true, replay: getReplay(getDb(), id) }
}

/** Re-links a replay the user matched to a game by hand. */
export function linkReplayToMatch(replayId: number, matchId: string): void {
  const db = getDb()
  setReplayMatch(db, replayId, matchId)

  const accountId = accountForMatch(db, matchId)
  if (accountId !== null) setReplayAccount(db, replayId, accountId)

  broadcastReplaysChanged()
}
