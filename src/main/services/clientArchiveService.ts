import { BrowserWindow } from 'electron'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { readdir, stat, statfs } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { createLogger } from '../telemetry/logger'
import { getSetting } from '../db/repositories/appSettings.repo'
import {
  addClientArchive,
  getClientArchives,
  removeClientArchive,
  setArchivePatch
} from '../db/repositories/clientArchives.repo'
import { discoverLcu } from '../lcu/discovery'
import { LCU_PATH_SETTING } from '../lcu/watcher'
import { fetchAutoRecordEnabled, fetchReplayFolder } from '../lcu/replays'
import { detectInstallPatch, isLeagueInstall } from '../rofl/install'
import { patchFromGameVersion } from '../rofl/patch'
import { defaultSourceFolders, getRoflSettings } from './roflSettings'
import type { ArchiveCopyProgress, ClientArchive, LiveClient, RoflSettings } from '@shared/types'

/**
 * The installs that can play replays, live and archived.
 *
 * Riot ships one League install and patches it in place, so a replay stops
 * being playable the moment the game moves on. Keeping an old patch around is
 * the only way back, and it is a thing the user does with disk they own — this
 * module remembers where those installs are and, if asked, makes a copy.
 */

const log = createLogger('rofl')

/** The live install when nothing else says otherwise, matching lcu/discovery. */
const DEFAULT_INSTALL = 'C:\\Riot Games\\League of Legends'

/* -------------------------------------------------------------------------- */
/* The live install                                                           */
/* -------------------------------------------------------------------------- */

/**
 * How long the live install's patch is trusted.
 *
 * Reading it spawns PowerShell, and it is wanted once per replay row — listing
 * the tab would otherwise cost a process launch per query, twice over, since
 * the usage figure asks the same question. The answer changes every two weeks,
 * so a minute of staleness is free; the only moment it is wrong is the minute
 * after a patch finishes installing, which the user is not watching this screen
 * for.
 */
const LIVE_CLIENT_TTL_MS = 60_000

let liveClientCache: { at: number; value: LiveClient } | null = null

/** Dropped when an archive is added or the install path changes. */
export function forgetLiveClient(): void {
  liveClientCache = null
}

/**
 * Where League is installed and which patch it is on.
 *
 * Never stored in the database. The patch changes every two weeks and a stored
 * answer would send a perfectly good replay to the "no client for this patch"
 * message for a fortnight after each patch day.
 *
 * The install path is already a setting — the LCU watcher uses it to find the
 * lockfile — so this reuses that answer rather than asking the user twice.
 */
export async function resolveLiveClient(): Promise<LiveClient> {
  const now = Date.now()
  if (liveClientCache !== null && now - liveClientCache.at < LIVE_CLIENT_TTL_MS) {
    return liveClientCache.value
  }

  const configured = getSetting(getDb(), LCU_PATH_SETTING)
  const candidates = [configured, DEFAULT_INSTALL].filter(
    (path): path is string => path !== null && path.trim() !== ''
  )

  let value: LiveClient = { path: null, patch: null }
  for (const candidate of candidates) {
    if (!isLeagueInstall(candidate)) continue
    value = { path: candidate, patch: await detectInstallPatch(candidate) }
    break
  }

  liveClientCache = { at: now, value }
  return value
}

/* -------------------------------------------------------------------------- */
/* Riot's replay folder                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which folder to watch.
 *
 * The user's own override wins, then whatever the running client reports, then
 * the documented default. Asking the client matters because the folder is
 * configurable inside League: watching the default when the user moved it is
 * how this feature would fail most silently.
 */
export async function resolveSourceFolder(override: string | null): Promise<string | null> {
  if (override !== null && override.trim() !== '') return override

  const creds = await discoverLcu(getSetting(getDb(), LCU_PATH_SETTING))
  if (creds !== null) {
    const reported = await fetchReplayFolder(creds)
    if (reported !== null) return reported
  }

  // First that actually exists, not first in the list: see defaultSourceFolders
  // for why the obvious one is so often the wrong one.
  return defaultSourceFolders().find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Settings, plus the two facts only the running client can supply.
 *
 * Kept out of roflSettings.ts so that reading settings stays synchronous and
 * free of network calls; this is the one place that pays for the answers.
 */
export async function getRoflSettingsWithClient(): Promise<RoflSettings> {
  const settings = getRoflSettings()
  const creds = await discoverLcu(getSetting(getDb(), LCU_PATH_SETTING))

  return {
    ...settings,
    resolvedSourceFolder: await resolveSourceFolder(settings.sourceFolder),
    autoRecordEnabled: creds === null ? null : await fetchAutoRecordEnabled(creds)
  }
}

/* -------------------------------------------------------------------------- */
/* The register                                                               */
/* -------------------------------------------------------------------------- */

export function listClientArchives(): ClientArchive[] {
  return getClientArchives(getDb())
}

/**
 * Registers a folder, working out its patch from the install itself.
 *
 * Refuses a folder that is not a League install. A path that cannot play
 * anything is worse than no entry: it would sit in the list looking like a
 * solution while every replay it claims to cover fails to open.
 */
export async function addArchive(
  path: string,
  label: string | null
): Promise<{ ok: boolean; error?: string; archive?: ClientArchive }> {
  if (!isLeagueInstall(path)) {
    return {
      ok: false,
      error: 'That folder does not contain Game\\League of Legends.exe. Pick a League install root.'
    }
  }

  const patch = await detectInstallPatch(path)
  if (patch === null) {
    return {
      ok: false,
      error: 'Foxfire could not read a patch version from that install. Add it and set the patch by hand.'
    }
  }

  const id = addClientArchive(getDb(), { path, patch, patchSource: 'detected', label })
  log.info('Registered a client archive', { id, patch })

  const archive = listClientArchives().find((entry) => entry.id === id)
  return archive === undefined ? { ok: false, error: 'Could not store that archive.' } : { ok: true, archive }
}

/**
 * Overrides a detected patch.
 *
 * Detection reads the executable, which reports the version the install is on
 * its way to when a patch was interrupted. That is rare and unrecoverable
 * without a way to say what the folder actually is.
 */
export function setArchivePatchByHand(id: number, patch: string): { ok: boolean; error?: string } {
  const normalised = patchFromGameVersion(patch)
  if (normalised === null) {
    return { ok: false, error: 'Enter a patch like 15.14.' }
  }
  setArchivePatch(getDb(), id, normalised)
  return { ok: true }
}

export function removeArchive(id: number): void {
  removeClientArchive(getDb(), id)
  log.info('Removed a client archive', { id })
}

/* -------------------------------------------------------------------------- */
/* Copying an install                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Copying the live install so this patch stays playable after Riot moves on.
 *
 * The whole install root, not just Game\. The launcher, the manifests and the
 * client all sit outside Game\, and an archive that turns out to be missing one
 * of them fails weeks later, when the original is long gone and there is
 * nothing to compare against. Disk is cheaper than that.
 *
 * Copied file by file rather than with fs.cp so there is something to report:
 * this moves tens of gigabytes and a silent progress-free freeze would look
 * exactly like a hang.
 */
let cancelRequested = false

export function cancelArchiveCopy(): void {
  cancelRequested = true
}

function broadcastCopyProgress(progress: ArchiveCopyProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.archives.copyProgress, progress)
  }
}

interface FileEntry {
  from: string
  to: string
  bytes: number
}

async function walk(root: string, destination: string): Promise<FileEntry[]> {
  const files: FileEntry[] = []

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const from = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(from)
      } else if (entry.isFile()) {
        try {
          const { size } = await stat(from)
          files.push({ from, to: join(destination, relative(root, from)), bytes: size })
        } catch {
          // A file that vanished mid-walk is one the copy would skip anyway.
          continue
        }
      }
    }
  }

  await visit(root)
  return files
}

/** Bytes free on the volume holding `path`, or null when it cannot be determined. */
export async function freeSpaceFor(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path)
    return Number(stats.bsize) * Number(stats.bavail)
  } catch {
    return null
  }
}

export async function archiveLiveClient(
  destination: string
): Promise<{ ok: boolean; error?: string; archive?: ClientArchive }> {
  const live = await resolveLiveClient()
  if (live.path === null) {
    return { ok: false, error: 'Foxfire could not find your League install.' }
  }
  if (live.patch === null) {
    return { ok: false, error: 'Foxfire could not read the patch of your League install.' }
  }

  const target = join(destination, `League of Legends ${live.patch}`)
  if (existsSync(target)) {
    return { ok: false, error: `${target} already exists. Pick another folder or remove it first.` }
  }

  cancelRequested = false
  const files = await walk(live.path, target)
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)

  const free = await freeSpaceFor(destination)
  if (free !== null && free < totalBytes) {
    return {
      ok: false,
      error: `That install is ${gb(totalBytes)} and the destination has ${gb(free)} free.`
    }
  }

  log.info('Archiving the live client', { patch: live.patch, files: files.length, totalBytes })

  let copiedBytes = 0
  for (const [index, file] of files.entries()) {
    if (cancelRequested) {
      log.info('Archive copy cancelled', { copiedBytes })
      broadcastCopyProgress({ copiedBytes, totalBytes, currentFile: null, done: true, cancelled: true })
      return { ok: false, error: 'Cancelled. The part-copied folder is still on disk.' }
    }

    try {
      mkdirSync(join(file.to, '..'), { recursive: true })
      copyFileSync(file.from, file.to)
    } catch (err) {
      log.warn('Could not copy a file while archiving', { from: file.from, error: String(err) })
      broadcastCopyProgress({ copiedBytes, totalBytes, currentFile: null, done: true, cancelled: false })
      return { ok: false, error: `Copy failed on ${file.from}.` }
    }

    copiedBytes += file.bytes

    // Reporting every file would flood the bridge on an install with tens of
    // thousands of them, and the user cannot read that fast anyway.
    if (index % 64 === 0 || index === files.length - 1) {
      broadcastCopyProgress({
        copiedBytes,
        totalBytes,
        currentFile: relative(live.path, file.from),
        done: false,
        cancelled: false
      })
    }
  }

  broadcastCopyProgress({ copiedBytes, totalBytes, currentFile: null, done: true, cancelled: false })

  const id = addClientArchive(getDb(), {
    path: target,
    patch: live.patch,
    patchSource: 'detected',
    label: `Archived ${new Date().toISOString().slice(0, 10)}`
  })

  const archive = listClientArchives().find((entry) => entry.id === id)
  return archive === undefined ? { ok: true } : { ok: true, archive }
}

function gb(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
