import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
 * Starts OBS minimised, unless it is already running.
 *
 * There is no reliable way to ask "is OBS running" without shelling out, so
 * this does not try: launching a second instance is harmless because OBS
 * refuses to start one and exits immediately, which leaves the first instance —
 * and its websocket — exactly as it was.
 */
export function launchObs(configuredPath: string | null): void {
  if (isObsRunningFromUs()) return

  const exe = resolveObsExecutable(configuredPath)
  if (!exe) {
    log.debug('OBS executable not found', { configuredPath })
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
