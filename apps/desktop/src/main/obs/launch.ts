import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { createLogger } from '../telemetry/logger'

/**
 * Starting OBS so it is always there when a game begins.
 *
 * Launched with the app rather than when a game starts: OBS takes several
 * seconds to come up and another second or two to accept a websocket
 * connection, and a game that has already reached the loading screen does not
 * wait. Starting it early costs idle memory and buys never missing a first game.
 *
 * Whether we started it is remembered, because quitting an OBS the user was
 * already using — possibly mid-stream — would be indefensible.
 */
const log = createLogger('obs')

/** The usual install locations, tried in order when no path is configured. */
const DEFAULT_PATHS = [
  'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe',
  'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs64.exe'
]

let ourProcess: ReturnType<typeof spawn> | null = null

/** The launch under way, so two calls at once cannot both decide to start one. */
let launching: Promise<void> | null = null

/**
 * Resolves the executable from a configured path.
 *
 * Accepts either the exe itself or the install root, because "where is OBS
 * installed" is answered with the folder at least as often as with the binary —
 * the same latitude the League install path setting allows.
 */
export function resolveObsExecutable(configured: string | null): string | null {
  const candidates: string[] = []

  if (configured) {
    candidates.push(
      configured.toLowerCase().endsWith('.exe')
        ? configured
        : join(configured, 'bin', '64bit', 'obs64.exe'),
      join(configured, 'obs64.exe')
    )
  }
  candidates.push(...DEFAULT_PATHS)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function isObsRunningFromUs(): boolean {
  return ourProcess !== null && ourProcess.exitCode === null
}

/**
 * Whether something is already listening on the websocket port.
 *
 * Asked first because it is the quickest answer and the only one that counts an
 * OBS on another machine. A no from it does not mean there is no OBS, though:
 * see obsIsRunning.
 *
 * Observed rather than assumed: this used to launch unconditionally on the
 * theory that a second OBS exits on its own. It does not. Two instances were
 * left running, and only one of them could hold port 4455.
 */
function websocketIsListening(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (answer: boolean): void => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Whether an OBS is running on this PC at all, listening or not.
 *
 * The port alone could not say. OBS opens its websocket only once it has
 * finished loading, seconds after it starts, and never while the server is
 * switched off in its settings — so an OBS the user had just opened, or one
 * starting alongside this app at sign-in, read as no OBS, and a second one was
 * launched beside it to sit on OBS's "already running" prompt. A running OBS is
 * all this app needs: the websocket client keeps retrying until it answers.
 *
 * A query that fails reads as no OBS, so the launch goes ahead as it did before.
 */
function obsIsRunning(image: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        // A match is a row opening with the name in quotes. Read for that rather
        // than for the "no tasks" line, which Windows prints in its own language.
        resolve(!err && String(stdout).toLowerCase().includes(`"${image.toLowerCase()}"`))
      }
    )
  })
}

/**
 * Starts OBS minimised, unless one is already there.
 *
 * An OBS the user started themselves — including one left over from a previous
 * run of this app — counts and is left alone. Called on every settings change as
 * well as at startup, so a call made while the checks are still out joins them:
 * two sets of checks side by side would both find no OBS, and both launch one.
 */
export function launchObs(
  configuredPath: string | null,
  host = '127.0.0.1',
  port = 4455
): Promise<void> {
  if (!launching) {
    launching = launchUnlessRunning(configuredPath, host, port).finally(() => {
      launching = null
    })
  }
  return launching
}

async function launchUnlessRunning(
  configuredPath: string | null,
  host: string,
  port: number
): Promise<void> {
  if (isObsRunningFromUs()) return
  if (await websocketIsListening(host, port)) {
    log.debug('OBS already listening; not launching another', { host, port })
    return
  }

  const exe = resolveObsExecutable(configuredPath)
  if (!exe) {
    log.debug('OBS executable not found', { configuredPath })
    return
  }
  if (await obsIsRunning(basename(exe))) {
    log.debug('OBS already running; connecting to it rather than launching another', {
      host,
      port
    })
    return
  }

  try {
    const child = spawn(
      exe,
      [
        '--minimize-to-tray',
        // Suppresses the "OBS did not shut down cleanly, restore your scenes?"
        // dialog, which is modal and would sit there blocking the websocket
        // until somebody clicked it.
        '--disable-shutdown-check'
      ],
      {
        // OBS resolves its locale and plugin paths relative to the working
        // directory, and starting it from ours makes it fail to find them.
        cwd: dirname(exe),
        detached: true,
        stdio: 'ignore'
      }
    )
    child.unref()
    child.on('error', (err) => log.debug('OBS launch failed', { error: String(err) }))
    ourProcess = child
    log.debug('Launched OBS', { exe })
  } catch (err) {
    log.debug('OBS launch threw', { error: String(err) })
  }
}

/**
 * Stops the OBS we started, and only that one.
 *
 * An OBS the user launched themselves is left alone: it may be recording or
 * streaming something that has nothing to do with this app.
 */
export function quitLaunchedObs(): void {
  if (!isObsRunningFromUs() || !ourProcess) return
  try {
    ourProcess.kill()
  } catch (err) {
    log.debug('Could not stop OBS', { error: String(err) })
  }
  ourProcess = null
}
