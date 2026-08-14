import type { DatabaseSync } from 'node:sqlite'
import type { Account, LeagueEntry, QueueType } from '@shared/types'

interface AccountRow {
  id: number
  puuid: string
  game_name: string
  tag_line: string
  platform: string
  regional_route: string
  summoner_id: string | null
  profile_icon_id: number | null
  summoner_level: number | null
  is_home_account: number
  created_at: string
  updated_at: string
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    puuid: row.puuid,
    gameName: row.game_name,
    tagLine: row.tag_line,
    platform: row.platform,
    regionalRoute: row.regional_route,
    summonerId: row.summoner_id,
    profileIconId: row.profile_icon_id,
    summonerLevel: row.summoner_level,
    isHomeAccount: row.is_home_account === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listAccounts(db: DatabaseSync): Account[] {
  const rows = db
    .prepare('SELECT * FROM accounts ORDER BY is_home_account DESC, created_at ASC')
    .all() as unknown as AccountRow[]
  return rows.map(toAccount)
}

export function getAccountById(db: DatabaseSync, id: number): Account | null {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
    | unknown as AccountRow
    | undefined
  return row ? toAccount(row) : null
}

export function getAccountByPuuid(db: DatabaseSync, puuid: string): Account | null {
  const row = db.prepare('SELECT * FROM accounts WHERE puuid = ?').get(puuid) as
    | unknown as AccountRow
    | undefined
  return row ? toAccount(row) : null
}

export function getHomeAccount(db: DatabaseSync): Account | null {
  const row = db.prepare('SELECT * FROM accounts WHERE is_home_account = 1').get() as
    | unknown as AccountRow
    | undefined
  return row ? toAccount(row) : null
}

export interface InsertAccountInput {
  puuid: string
  gameName: string
  tagLine: string
  platform: string
  regionalRoute: string
  summonerId: string | null
  profileIconId: number | null
  summonerLevel: number | null
}

export function insertAccount(db: DatabaseSync, input: InsertAccountInput): number {
  const result = db
    .prepare(
      `INSERT INTO accounts
        (puuid, game_name, tag_line, platform, regional_route, summoner_id, profile_icon_id, summoner_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.puuid,
      input.gameName,
      input.tagLine,
      input.platform,
      input.regionalRoute,
      input.summonerId,
      input.profileIconId,
      input.summonerLevel
    )
  return Number(result.lastInsertRowid)
}

/** Refreshes the mutable profile fields Riot may have changed since we last looked. */
export function updateAccountProfile(
  db: DatabaseSync,
  id: number,
  fields: {
    gameName: string
    tagLine: string
    summonerId: string | null
    profileIconId: number | null
    summonerLevel: number | null
  }
): void {
  db.prepare(
    `UPDATE accounts
       SET game_name = ?, tag_line = ?, summoner_id = ?, profile_icon_id = ?, summoner_level = ?,
           updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    fields.gameName,
    fields.tagLine,
    fields.summonerId,
    fields.profileIconId,
    fields.summonerLevel,
    id
  )
}

export function setHomeAccount(db: DatabaseSync, id: number): void {
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE accounts SET is_home_account = 0').run()
    db.prepare('UPDATE accounts SET is_home_account = 1 WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function deleteAccount(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

export function countAccounts(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as unknown as { n: number }
  return row.n
}

const TRACKED_QUEUES: QueueType[] = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']

interface LeagueEntryRow {
  queue_type: string
  tier: string | null
  rank: string | null
  league_points: number | null
  wins: number | null
  losses: number | null
  fetched_at: string
}

export function getLeagueEntries(db: DatabaseSync, accountId: number): LeagueEntry[] {
  const rows = db
    .prepare('SELECT * FROM league_entries WHERE account_id = ?')
    .all(accountId) as unknown as LeagueEntryRow[]
  return rows.map((row) => ({
    queueType: row.queue_type as QueueType,
    tier: row.tier,
    rank: row.rank,
    leaguePoints: row.league_points,
    wins: row.wins,
    losses: row.losses,
    fetchedAt: row.fetched_at
  }))
}

export function upsertLeagueEntries(
  db: DatabaseSync,
  accountId: number,
  entries: Array<{
    queueType: string
    tier?: string
    rank?: string
    leaguePoints?: number
    wins?: number
    losses?: number
  }>
): void {
  const stmt = db.prepare(
    `INSERT INTO league_entries
       (account_id, queue_type, tier, rank, league_points, wins, losses, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(account_id, queue_type) DO UPDATE SET
       tier = excluded.tier, rank = excluded.rank, league_points = excluded.league_points,
       wins = excluded.wins, losses = excluded.losses, fetched_at = excluded.fetched_at`
  )

  db.exec('BEGIN')
  try {
    for (const entry of entries) {
      if (!TRACKED_QUEUES.includes(entry.queueType as QueueType)) continue
      stmt.run(
        accountId,
        entry.queueType,
        entry.tier ?? null,
        entry.rank ?? null,
        entry.leaguePoints ?? null,
        entry.wins ?? null,
        entry.losses ?? null
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
