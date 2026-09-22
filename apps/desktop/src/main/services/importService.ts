import { DatabaseSync } from 'node:sqlite'
import { dialog } from 'electron'
import { emptyImport, importStatsDb, type SqliteReader } from '@foxfire/core/import'
import { serverApi } from './serverService'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import type { ImportResult } from '@shared/types'

const log = createLogger('import')

/**
 * Moving an old stats.db into the server this machine administers.
 *
 * What gets sent, in which order and why, is @foxfire/core's import — the web
 * client's admin page runs the same one. This is the desktop's way in to it: a
 * native file picker, and node:sqlite reading the file straight off the disk.
 */

/** Asks for the file. Returns null when the dialog was dismissed. */
export async function chooseImportDatabase(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Foxfire database to import',
    properties: ['openFile'],
    filters: [
      { name: 'Foxfire database', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })

  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/**
 * Reads a stats.db and pushes it at the active server.
 *
 * Progress is broadcast rather than returned, because the whole run is minutes
 * — a Riot lookup per account and a page of matches per request — and a
 * settings panel that sat on one promise would have nothing to say for all of
 * it.
 */
export async function importDatabase(filePath: string): Promise<ImportResult> {
  let db: DatabaseSync

  try {
    // Read-only, and never modified. This is somebody's only copy of their
    // history, and an import that corrupted it would be unforgivable for a
    // feature whose whole purpose is not losing it.
    db = new DatabaseSync(filePath, { readOnly: true })
  } catch {
    return { ok: false, message: 'That file could not be opened as a Foxfire database.', ...emptyImport() }
  }

  const reader: SqliteReader = {
    all: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
      db.prepare(sql).all(...params) as unknown as T[],
    get: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
      db.prepare(sql).get(...params) as unknown as T | undefined
  }

  try {
    return await importStatsDb(
      reader,
      serverApi().importer,
      (progress) => broadcast(CH.serverAdmin.importProgress, progress),
      { log }
    )
  } finally {
    db.close()
  }
}
