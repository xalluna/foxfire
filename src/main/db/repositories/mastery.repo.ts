import type { DatabaseSync } from 'node:sqlite'
import type { MasteryEntry } from '@shared/types'
import type { ChampionMasteryDto } from '../../riot/types'

export function upsertMastery(
  db: DatabaseSync,
  accountId: number,
  entries: ChampionMasteryDto[]
): void {
  const stmt = db.prepare(
    `INSERT INTO champion_mastery
       (account_id, champion_id, champion_points, champion_level, last_play_time, fetched_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(account_id, champion_id) DO UPDATE SET
       champion_points = excluded.champion_points,
       champion_level = excluded.champion_level,
       last_play_time = excluded.last_play_time,
       fetched_at = excluded.fetched_at`
  )

  db.exec('BEGIN')
  try {
    for (const entry of entries) {
      stmt.run(
        accountId,
        entry.championId,
        entry.championPoints,
        entry.championLevel,
        entry.lastPlayTime
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function getMastery(db: DatabaseSync, accountId: number): MasteryEntry[] {
  const rows = db
    .prepare(
      `SELECT champion_id, champion_points, champion_level, last_play_time
         FROM champion_mastery
        WHERE account_id = ?
        ORDER BY champion_points DESC`
    )
    .all(accountId) as unknown as Array<{
    champion_id: number
    champion_points: number
    champion_level: number
    last_play_time: number | null
  }>

  return rows.map((row) => ({
    championId: row.champion_id,
    championPoints: row.champion_points,
    championLevel: row.champion_level,
    lastPlayTime: row.last_play_time
  }))
}
