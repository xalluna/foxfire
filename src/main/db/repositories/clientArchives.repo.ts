import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { ArchivePatchSource, ClientArchive } from '@shared/types'

/**
 * The register of League installs kept around to play old replays.
 *
 * Paths, not copies. A game install is tens of gigabytes and belongs wherever
 * the user decided to put it; Foxfire's job is to remember where that is and
 * which patch lives there, not to become a backup tool.
 *
 * The live install is deliberately absent. It is always available and its patch
 * changes every two weeks, so a row describing it would spend most of its life
 * wrong. It is resolved fresh whenever it is needed instead.
 */

interface ArchiveRow {
  id: number
  path: string
  patch: string
  patch_source: string
  label: string | null
}

function toArchive(row: ArchiveRow): ClientArchive {
  return {
    id: row.id,
    path: row.path,
    patch: row.patch,
    // Anything unrecognised is treated as detected: the column exists to stop a
    // refresh overwriting a hand-typed value, and defaulting the other way would
    // make a corrupt row permanently uneditable by detection.
    patchSource: row.patch_source === 'manual' ? 'manual' : 'detected',
    label: row.label,
    pathExists: existsSync(row.path)
  }
}

export function getClientArchives(db: DatabaseSync): ClientArchive[] {
  const rows = db
    .prepare('SELECT id, path, patch, patch_source, label FROM client_archives ORDER BY patch DESC')
    .all() as unknown as ArchiveRow[]
  return rows.map(toArchive)
}

/** Just the pairs the runner lookup needs, without the filesystem checks. */
export function getArchivePatches(db: DatabaseSync): Array<{ patch: string; path: string }> {
  return db.prepare('SELECT patch, path FROM client_archives').all() as unknown as Array<{
    patch: string
    path: string
  }>
}

export function addClientArchive(
  db: DatabaseSync,
  input: { path: string; patch: string; patchSource: ArchivePatchSource; label: string | null }
): number {
  db.prepare(
    `INSERT INTO client_archives (path, patch, patch_source, label)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET patch = excluded.patch,
                                     patch_source = excluded.patch_source,
                                     label = excluded.label`
  ).run(input.path, input.patch, input.patchSource, input.label)

  const row = db.prepare('SELECT id FROM client_archives WHERE path = ?').get(input.path) as {
    id: number
  }
  return row.id
}

/**
 * Correcting a patch by hand marks it manual, so a later detection pass leaves
 * it alone. Detection has been wrong before — a partially patched install
 * reports the version it is on the way to, not the one it can play.
 */
export function setArchivePatch(db: DatabaseSync, id: number, patch: string): void {
  db.prepare("UPDATE client_archives SET patch = ?, patch_source = 'manual' WHERE id = ?").run(
    patch,
    id
  )
}

export function removeClientArchive(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM client_archives WHERE id = ?').run(id)
}
