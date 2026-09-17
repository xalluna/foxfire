import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createLogger } from '../telemetry/logger'
import { patchFromGameVersion } from './patch'

/**
 * Working out which patch a League install is on.
 *
 * The install itself is the only honest source. A folder name lies as soon as
 * it is renamed, and the client's own patch endpoint only ever describes the
 * live install — useless for an archive sitting on a spare drive.
 *
 * So the game executable's version resource is read directly. On this machine
 * that reports 16.16.804.9184, which reduces to the 16.16 a replay header would
 * name. It is the same number from both ends, which is the property that makes
 * the whole runner lookup work.
 */

const log = createLogger('rofl')
const run = promisify(execFile)

/** Where the playable game lives inside an install root. */
const GAME_EXE = join('Game', 'League of Legends.exe')

export function gameExecutable(installRoot: string): string {
  return join(installRoot, GAME_EXE)
}

/**
 * True when this folder looks like something that could play a replay.
 *
 * Checked before a folder is ever registered, so "I picked the wrong directory"
 * fails at the moment of picking rather than silently much later, when a replay
 * refuses to open and nothing says why.
 */
export function isLeagueInstall(installRoot: string): boolean {
  return existsSync(gameExecutable(installRoot))
}

/**
 * The patch an install can play, as major.minor.
 *
 * PowerShell rather than a native module, matching how lcu/discovery.ts already
 * shells out — this runs rarely, and adding a compiled dependency to read one
 * string would be a poor trade for a project that deliberately avoids native
 * builds.
 */
export async function detectInstallPatch(installRoot: string): Promise<string | null> {
  const exe = gameExecutable(installRoot)
  if (!existsSync(exe)) return null

  try {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // Single-quoted inside PowerShell so nothing in the path is expanded,
        // with embedded quotes doubled — install paths contain spaces and have
        // been known to contain apostrophes.
        `(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`
      ],
      { timeout: 10_000, windowsHide: true }
    )

    const patch = patchFromGameVersion(stdout.trim())
    if (patch === null) {
      log.warn('Read a game version that made no sense', { installRoot, stdout: stdout.trim() })
    }
    return patch
  } catch (err) {
    log.debug('Could not read the game version', { installRoot, error: String(err) })
    return null
  }
}
