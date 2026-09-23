import { app, net } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { probeServer } from '@foxfire/core/server'
import { broadcast } from '../ipc/broadcast'
import { CH } from '../ipc/channels'
import { getAppIconState, onAppIconState } from '../appIcon'
import { clientIdentity, getServerState, onServerState } from '../services/serverService'
import { getMainWindow } from '../window'
import { createLogger } from '../telemetry/logger'
import { blockerFor } from './blocker'
import { feedUrl, overrideFeed } from './feed'
import { newestDesktopVersion } from './newest'
import { markRelaunchHidden, notesFor, setPendingInstall, type PendingInstall } from './pending'
import { resolveTarget, type ActiveServer } from './target'
import type { UpdateBlocker, UpdateState, UpdateStatus } from '@shared/types'

/**
 * Keeping this copy of Foxfire current.
 *
 * Updates come from the desktop's own GitHub Releases: `latest.yml` beside the
 * installer it describes, read by electron-updater. What is asked for is not
 * simply the newest release, though — it is the newest build the active server
 * will accept, which is what keeps an update from walking somebody straight
 * into a 426 from their own community. target.ts holds that reasoning.
 *
 * Nothing installs on its own while the app is open. The download is quiet, and
 * then the offer sits in the window and the tray until somebody takes it, or
 * until the app is quit — the other moment it is safe to replace the files
 * underneath a running process.
 */
const log = createLogger('updater')

/**
 * Long enough after launch to be behind the sync sweep and the replay scan,
 * both of which the user is waiting on and this is not.
 */
const FIRST_CHECK_MS = 60_000

/** Foxfire is left running for whole evenings; a few times a day is plenty. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus = 'disabled'
let target: string | null = null
let percent: number | null = null
let notes: string | null = null
let heldBy: UpdateState['heldBy'] = null
let error: string | null = null
let justInstalled: UpdateState['justInstalled'] = null

/** Guards against a scheduled check and a clicked one running at once. */
let checking = false

/** What the last announcement said about the server, to avoid idle re-checks. */
let lastServerKey = ''

type Listener = (state: UpdateState) => void
const listeners = new Set<Listener>()

export function getUpdateState(): UpdateState {
  return {
    status,
    current: app.getVersion(),
    target,
    percent,
    // With nothing on the way, the notes worth showing are the ones this build
    // arrived with — which is what the About page answers "what's new" from.
    notes: target === null ? currentNotes() : notes,
    blockedBy: blocker(),
    heldBy,
    error,
    justInstalled
  }
}

/** For the tray, which owns its own menu and only wants to be told. */
export function onUpdateState(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Starts the updater, and reports an update that has just landed.
 *
 * `installed` is the record the previous run left behind — see pending.ts. It
 * arrives from the bootstrap rather than being read here because the same
 * record decides whether this launch shows its window at all, and that has to
 * be settled before the window is built.
 */
export function initUpdater(installed: PendingInstall | null): void {
  if (installed !== null) {
    justInstalled = { version: installed.version, notes: installed.notes }
    log.info('Restarted into the build that was installed', { version: installed.version })
  }

  if (!app.isPackaged) {
    // A dev build's version is Electron's own, and there is nothing on GitHub
    // that could update it. Left `disabled` so the About page says so rather
    // than sitting on "checking" forever.
    log.debug('Updates are off in a development build')
    return
  }

  status = 'idle'
  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = true
  // The one install this does without being asked. Quitting is already the
  // moment the app's files are nobody's business, and an update that waits for
  // a restart that never comes is an update nobody gets.
  autoUpdater.autoInstallOnAppQuit = true
  // The active server can name an older build than this one when its host is
  // behind; that is the server's problem to fix, never a downgrade to install.
  autoUpdater.allowDowngrade = false

  wireUpdaterEvents()

  // The offer has to enable and disable with the game, and the tray menu is
  // rebuilt from the same announcement.
  onAppIconState(() => announce())

  lastServerKey = serverKey()
  onServerState((state) => {
    const key = `${state.activeUrl ?? ''}|${state.upgradeRequired ?? ''}`
    if (key === lastServerKey) return
    lastServerKey = key
    // A refusal names the version to install, and switching servers changes
    // which one that is. Neither should wait for the next scheduled check.
    void checkForUpdates()
  })

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

/**
 * Asks whoever has a say, then asks GitHub for whatever they named.
 *
 * Never throws: every failure here is something to put on the About page and
 * try again later. A check that cannot reach the server or GitHub leaves the
 * app exactly as it was.
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged || checking) return getUpdateState()

  // Already downloaded, or on the way. Nothing to learn from asking again, and
  // a check that reset this would take the Restart button off the screen.
  //
  // Switching servers between the download and the restart is the one case
  // this gets wrong: the offer still names the version the previous server
  // wanted. Left alone deliberately — electron-updater installs a downloaded
  // update on quit whatever this module believes, so withdrawing the offer
  // would only make the same install happen with no warning first. The outcome
  // is a server reporting itself older than this copy, which the Server page
  // already explains and which its host can fix.
  if (status === 'ready' || status === 'downloading') return getUpdateState()

  checking = true
  status = 'checking'
  announce()

  try {
    // A feed named in the environment answers for everybody. It exists to
    // rehearse an update against a folder on one machine — there is no
    // releases page there to read a newest version from, and no server with an
    // opinion about it — so electron-updater compares what it finds with what
    // is running and that is the whole decision. Said out loud in the log,
    // because it means the rules below were not applied.
    const override = overrideFeed()
    if (override !== null) {
      log.warn('Taking updates from the feed named in the environment', { url: override })
      heldBy = null
      autoUpdater.setFeedURL({ provider: 'generic', url: override })
      await autoUpdater.checkForUpdates()
      return getUpdateState()
    }

    const server = await activeServer()
    const newest = await newestRelease()
    const decision = resolveTarget({ current: app.getVersion(), server, newest })

    heldBy =
      decision.kind === 'held'
        ? { serverName: decision.serverName, allows: decision.allows, newest: decision.newest }
        : null

    if (decision.kind !== 'install') {
      status = 'idle'
      target = null
      percent = null
      error = null
      log.debug('Nothing to install', { decision: decision.kind })
      return getUpdateState()
    }

    log.info('Fetching an update', { version: decision.version })
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl(decision.version) })
    await autoUpdater.checkForUpdates()
    return getUpdateState()
  } catch (err) {
    record(err)
    return getUpdateState()
  } finally {
    checking = false
    announce()
  }
}

/**
 * Installs what was downloaded, and comes back.
 *
 * Refused outright while a game or a recording is on. The button that calls
 * this is already disabled then; this is the same rule stated where it cannot
 * be got around, since the tray menu and the window both reach it.
 */
export function restartToUpdate(): void {
  if (status !== 'ready') return

  const blocked = blocker()
  if (blocked !== null) {
    log.warn('Refused to restart for an update', { blockedBy: blocked })
    return
  }

  // Where to come back to. The installer relaunches the app with `--updated`
  // and nothing else, so a copy restarted out of the tray would otherwise
  // reappear as a window nobody asked for, in front of whatever they were
  // doing.
  markRelaunchHidden(getMainWindow()?.isVisible() !== true)
  log.info('Restarting to install', { version: target })

  // Silent, because the folder and the install mode were settled when this copy
  // was installed and the installer reads both back; and force-run, because
  // somebody asked for a restart rather than a shutdown.
  autoUpdater.quitAndInstall(true, true)
}

/** Drops the "what's new" note once it has been read. */
export function dismissInstalledNote(): void {
  if (justInstalled === null) return
  justInstalled = null
  announce()
}

function wireUpdaterEvents(): void {
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    target = info.version
    notes = notesFrom(info)
    status = 'downloading'
    percent = 0
    error = null
    log.info('Downloading', { version: info.version })
    announce()
  })

  autoUpdater.on('update-not-available', () => {
    // The feed was reachable and named a version this build already is, which
    // is what happens whenever a server names the build that is running.
    status = 'idle'
    target = null
    percent = null
    announce()
  })

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    const next = Math.round(progress.percent)
    // Every chunk fires this. Announcing each one would rebuild the tray menu
    // a few thousand times for a hundred-megabyte download.
    if (next === percent) return
    percent = next
    announce()
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    status = 'ready'
    percent = 100
    target = info.version
    notes = notesFrom(info)
    error = null
    // Written down before anything is offered: from here on the install can
    // happen on a quit nobody announced, and the build that comes back has to
    // know what it arrived with.
    setPendingInstall({ version: info.version, notes, relaunchHidden: false })
    log.info('Ready to install', { version: info.version })
    announce()
  })

  autoUpdater.on('error', (err: Error) => {
    record(err)
    announce()
  })
}

/**
 * Turns a failure into something to show, or into nothing at all.
 *
 * A 404 is the ordinary case rather than a fault: the server is tagged before
 * the desktop, so a server's allow list can name a release whose files are
 * still minutes from being published. Saying "update failed" for the gap
 * between two tags would be alarming and wrong.
 */
function record(err: unknown): void {
  const text = err instanceof Error ? err.message : String(err)

  if (text.includes('404')) {
    log.debug('The target release is not published yet', { version: target, error: text })
    status = 'idle'
    target = null
    percent = null
    return
  }

  status = 'error'
  percent = null
  error = text
  log.warn('Update check failed', { error: text })
}

/** What the active server accepts, or null when nothing is answering for one. */
async function activeServer(): Promise<ActiveServer | null> {
  const state = getServerState()
  if (state.activeUrl === null) return null

  const name = state.servers.find((s) => s.isActive)?.name ?? state.activeUrl
  const probed = await probeServer(state.activeUrl, clientIdentity())

  if (!probed.reachable || probed.recommendedDesktop === null) return { name, reachable: false }
  return { name, reachable: true, recommended: probed.recommendedDesktop }
}

async function newestRelease(): Promise<string | null> {
  try {
    // Chromium's stack rather than Node's, so a machine that reaches GitHub
    // only through a system proxy is not told there are no releases — the same
    // stack electron-updater downloads through.
    return await newestDesktopVersion((input, init) => net.fetch(input as string, init))
  } catch (err) {
    log.debug('Could not read the newest release', { error: String(err) })
    return null
  }
}

function blocker(): UpdateBlocker | null {
  return blockerFor(getAppIconState())
}

function serverKey(): string {
  const state = getServerState()
  return `${state.activeUrl ?? ''}|${state.upgradeRequired ?? ''}`
}

/**
 * What this build arrived with, read from the database once.
 *
 * Cached because getUpdateState is called for every announcement, and a
 * download announces on each whole percent: a hundred SQLite reads to answer
 * the same question about a version that cannot change while the process is
 * running. `undefined` is "not read yet"; null is "read, and there were none",
 * which is the ordinary answer for a copy installed by hand.
 */
let installedNotes: string | null | undefined

function currentNotes(): string | null {
  if (installedNotes === undefined) installedNotes = notesFor(app.getVersion())
  return installedNotes
}

function notesFrom(info: UpdateInfo): string | null {
  const raw = info.releaseNotes
  if (typeof raw === 'string') return raw.trim() || null
  if (Array.isArray(raw)) {
    return (
      raw
        .map((entry) => entry.note ?? '')
        .join('\n\n')
        .trim() || null
    )
  }
  return null
}

function announce(): void {
  const state = getUpdateState()
  broadcast(CH.updates.changed, state)
  for (const listener of listeners) listener(state)
}

/**
 * electron-updater's own chatter, folded into the app's log.
 *
 * Capped, because one of its info lines is the entire list of byte ranges a
 * differential download worked out — several thousand of them for a hundred
 * megabytes, as one string. The useful part of every message is its beginning,
 * and a log nobody can scroll through is a log nobody reads.
 */
const MAX_LINE = 500

const updaterLogger = {
  info: (message?: unknown) => log.info(clip(message)),
  warn: (message?: unknown) => log.warn(clip(message)),
  error: (message?: unknown) => log.error(clip(message)),
  debug: (message?: unknown) => log.debug(clip(message))
}

function clip(message: unknown): string {
  const text = String(message)
  return text.length <= MAX_LINE ? text : `${text.slice(0, MAX_LINE)}… (${text.length} chars)`
}
