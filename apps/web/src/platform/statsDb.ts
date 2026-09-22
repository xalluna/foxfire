import type { ImportProgress, ImportResult } from '@foxfire/core'
import { importStatsDb, type ImportTarget, type SqlParam, type SqliteReader } from '@foxfire/core/import'

/**
 * Asks for a stats.db, the way a browser can: a file input nobody sees.
 *
 * Resolves null when the picker is closed without a choice. Browsers only say
 * so by focusing the window again with nothing chosen, hence the listener.
 */
export function pickStatsDb(): Promise<{ source: File; label: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3'

    let settled = false
    const settle = (file: File | null): void => {
      if (settled) return
      settled = true
      resolve(file ? { source: file, label: file.name } : null)
    }

    input.addEventListener('change', () => settle(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => settle(null))
    input.click()
  })
}

/**
 * Reads a stats.db in the browser and pushes it to the server.
 *
 * The same importer the desktop runs, fed by sql.js instead of node:sqlite.
 * The whole file is held in memory while it runs, so a very large history is
 * better imported from the desktop; and a database still in use by a running
 * Foxfire keeps some of its writes in a -wal file beside it, which only the
 * desktop can see — close Foxfire first.
 *
 * sql.js and its WebAssembly are loaded here, on the first import, and never
 * for anybody who does not run one.
 */
export async function importStatsDbFile(
  file: File,
  target: ImportTarget,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const reader = await openStatsDb(file)
  try {
    return await importStatsDb(reader, target, onProgress)
  } finally {
    reader.close()
  }
}

async function openStatsDb(file: File): Promise<SqliteReader & { close(): void }> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url')
  ])

  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()))

  function rows<T>(sql: string, params: readonly SqlParam[] | undefined, limit?: number): T[] {
    const statement = db.prepare(sql)
    try {
      if (params) statement.bind([...params])
      const out: T[] = []
      while ((limit === undefined || out.length < limit) && statement.step()) {
        out.push(statement.getAsObject() as T)
      }
      return out
    } finally {
      statement.free()
    }
  }

  return {
    all: <T>(sql: string, params?: readonly SqlParam[]) => rows<T>(sql, params),
    get: <T>(sql: string, params?: readonly SqlParam[]) => rows<T>(sql, params, 1)[0],
    close: () => db.close()
  }
}
