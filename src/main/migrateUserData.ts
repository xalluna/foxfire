import { app, dialog } from 'electron'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { hasStoredApiKey } from './security/keyStore'
import { createLogger } from './telemetry/logger'

/**
 * Moves the data directory left behind by "LoL Stats".
 *
 * The app pinned its userData to %APPDATA%/my-op-gg, so the rename to Foxfire
 * strands the database, the logs and the encrypted Riot key unless they are
 * carried across. Everything durable the app owns lives under that one
 * directory, which is what makes this tractable: one move, not five.
 *
 * A rename rather than a copy, deliberately. Both directories sit under
 * %APPDATA% on the same volume, so the move is atomic — there is no half-copied
 * state to reason about, no torn read of a live SQLite file, and no second copy
 * of a database that can reach a few hundred megabytes. It also gives the
 * liveness check for free: Windows refuses to rename a directory holding an
 * open file, so an old build still running in the tray fails the move instead
 * of having its data pulled out from under it.
 */

/** The %APPDATA% folder the app used before the rename. */
const LEGACY_DIR = 'my-op-gg'

/**
 * Subdirectories carried across, in order of how much it hurts to lose them.
 *
 * Moved one at a time rather than renaming the parent, because the new
 * directory may already exist — a crash after the log sink opened is enough to
 * create it — and a rename onto an existing directory fails on Windows.
 */
const CARRIED = ['data', 'secure', 'logs'] as const

interface Outcome {
  /** True when this launch moved the legacy directory into place. */
  moved: boolean
  /** True when the legacy directory carried a stored Riot key. */
  hadApiKey: boolean
}

let outcome: Outcome = { moved: false, hadApiKey: false }

/**
 * Runs before the app is ready, immediately after userData is pinned.
 *
 * Nothing may have opened a file under userData yet — the log sink, both
 * databases and the key store all resolve their paths lazily at first use,
 * which is what makes this position safe.
 */
export function migrateUserData(): void {
  const legacy = join(app.getPath('appData'), LEGACY_DIR)
  const current = app.getPath('userData')

  // Keyed on the database, not on the directory. A log line written by a
  // previous failed launch is enough to create the new directory, and a bare
  // existsSync on it would then skip the move and strand the history for good.
  if (existsSync(join(current, 'data', 'stats.db'))) return
  if (!existsSync(join(legacy, 'data', 'stats.db'))) return

  const hadApiKey = existsSync(join(legacy, 'secure', 'riot-api-key.enc'))

  mkdirSync(current, { recursive: true })

  for (const name of CARRIED) {
    const from = join(legacy, name)
    const to = join(current, name)
    if (!existsSync(from) || existsSync(to)) continue

    try {
      renameSync(from, to)
    } catch (err) {
      // `data` is the only one worth stopping for. Losing `logs` costs nothing,
      // and `secure` re-prompts for a key, which is annoying but visible.
      if (name === 'data') {
        refuse(err)
        return
      }
    }
  }

  // Only when it is genuinely empty. Anything left behind is something this
  // function did not expect, and deleting it unread would be the wrong call.
  try {
    if (readdirSync(legacy).length === 0) rmSync(legacy, { recursive: true })
  } catch {
    // A directory that will not delete is cosmetic — the data is already moved.
  }

  outcome = { moved: true, hadApiKey }
}

/**
 * Stops the launch rather than starting on an empty database.
 *
 * Carrying on would create a fresh stats.db at the new path, and the guard
 * above keys on exactly that file — so the next launch would decide the
 * migration had already happened and the real history would be stranded
 * silently. Better to refuse and say why.
 */
function refuse(err: unknown): void {
  dialog.showErrorBox(
    'Foxfire could not move your data',
    'Foxfire found data from LoL Stats but could not move it, which usually means ' +
      'LoL Stats is still running.\n\n' +
      'Quit LoL Stats — check the system tray as well as the taskbar — and start ' +
      'Foxfire again.\n\n' +
      `Details: ${err instanceof Error ? err.message : String(err)}`
  )
  app.exit(1)
}

/**
 * The half of the check that has to wait for the app to be ready.
 *
 * safeStorage is not usable before then, so whether the key survived the move
 * cannot be answered where the move happens. It should always survive — DPAPI
 * binds the ciphertext to the OS user account, not to a path — but loadApiKey
 * turns a failed decrypt into a null, which surfaces as a quiet "enter your API
 * key" that is easy to mistake for a first run. This makes it loud instead.
 */
export function verifyMigration(): void {
  if (!outcome.moved) return

  const log = createLogger('migrate')
  log.warn('Moved the data directory across from LoL Stats', { hadApiKey: outcome.hadApiKey })

  if (outcome.hadApiKey && !hasStoredApiKey()) {
    log.error('The Riot API key did not survive the move')
    dialog.showErrorBox(
      'Your Riot API key needs re-entering',
      'Foxfire moved your data across from LoL Stats, but the stored Riot API key ' +
        'could not be read afterwards.\n\n' +
        'Everything else — match history, LP and seasons — came across intact. ' +
        'Open Settings and paste a key to carry on.'
    )
  }
}
