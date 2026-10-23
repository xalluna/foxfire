import type { DatabaseSync } from 'node:sqlite'
import type { GameId } from '@foxfire/core'
import type { Season, SeasonInput } from '@shared/types'

interface SeasonRow {
  id: number
  game: string
  label: string
  starts_at: number
  is_preseason: number
  resets_rank: number
}

function toSeason(row: SeasonRow): Season {
  return {
    id: row.id,
    label: row.label,
    startsAt: row.starts_at,
    isPreseason: row.is_preseason === 1,
    resetsRank: row.resets_rank === 1,
    game: row.game as GameId
  }
}

/**
 * One game's seasons, oldest first — the order every lookup in shared/seasons.ts
 * assumes. League's unless asked for TFT's sets: each game resets on its own
 * days, and a game is only ever cut by its own boundaries.
 */
export function listSeasons(db: DatabaseSync, game: GameId = 'lol'): Season[] {
  const rows = db
    .prepare(
      `SELECT id, game, label, starts_at, is_preseason, resets_rank
         FROM seasons
        WHERE game = ?
        ORDER BY starts_at ASC`
    )
    .all(game) as unknown as SeasonRow[]

  return rows.map(toSeason)
}

/**
 * Replaces the whole list with what the editor sent, preserving ids.
 *
 * Not a delete-all-and-reinsert: an id is what a selected period is encoded as
 * (`season:12`), so churning them would move the user's picker selection onto a
 * different season every time they saved. Rows that came back with an id are
 * updated in place, rows without one are new, and anything missing from the
 * payload was deleted in the editor.
 *
 * One transaction, because a half-applied list can express an ordering that the
 * UNIQUE constraint on starts_at would otherwise reject partway through.
 *
 * One game's list: saving League's never touches TFT's sets, and an id from the
 * other game's list is not this list's to update.
 */
export function saveSeasons(db: DatabaseSync, seasons: SeasonInput[], game: GameId = 'lol'): Season[] {
  db.exec('BEGIN')
  try {
    const keep = seasons.map((s) => s.id).filter((id): id is number => id !== undefined)

    // Deleting first frees any starts_at an updated row is about to claim,
    // which the UNIQUE index would otherwise refuse.
    const placeholders = keep.map(() => '?').join(', ')
    db.prepare(
      keep.length > 0
        ? `DELETE FROM seasons WHERE game = ? AND id NOT IN (${placeholders})`
        : 'DELETE FROM seasons WHERE game = ?'
    ).run(game, ...keep)

    const update = db.prepare(
      `UPDATE seasons SET label = ?, starts_at = ?, is_preseason = ?, resets_rank = ?
        WHERE id = ? AND game = ?`
    )
    const insert = db.prepare(
      `INSERT INTO seasons (label, starts_at, is_preseason, resets_rank, game) VALUES (?, ?, ?, ?, ?)`
    )

    for (const s of seasons) {
      const args = [s.label, s.startsAt, s.isPreseason ? 1 : 0, s.resetsRank ? 1 : 0] as const
      if (s.id === undefined) insert.run(...args, game)
      else update.run(...args, s.id, game)
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return listSeasons(db, game)
}
