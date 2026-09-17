import type { DatabaseSync } from 'node:sqlite'
import type { Account, LeagueEntry, QueueType } from '@shared/types'
import { TRACKED_QUEUES } from '@shared/queues'

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

/**
 * Looks an account up by Riot ID rather than puuid.
 *
 * Needed by the League client watcher: the client reports the canonical
 * account UUID (36 chars), while everything stored here comes from Riot's
 * public API, which returns a per-key *encrypted* puuid (78 chars). The two are
 * different identifiers in different namespaces and never compare equal, so the
 * Riot ID is the only key the two sources actually share.
 *
 * Compared case-insensitively — Riot IDs preserve display case but are unique
 * without regard to it.
 */
export function getAccountByRiotId(
  db: DatabaseSync,
  gameName: string,
  tagLine: string
): Account | null {
  const row = db
    .prepare('SELECT * FROM accounts WHERE LOWER(game_name) = LOWER(?) AND LOWER(tag_line) = LOWER(?)')
    .get(gameName, tagLine) as unknown as AccountRow | undefined
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

export interface RekeyResult {
  /** Stored match payloads that carried the old puuid. */
  matches: number
  /** Participant rows moved onto the new puuid. */
  participants: number
}

/**
 * Moves an account, and every row of history keyed by its puuid, onto the puuid
 * a new API key resolves it to.
 *
 * Riot encrypts puuids per key, so a key change invalidates every one this app
 * has stored — see 010_account_puuids.sql. Rewriting the stored value is what
 * repairs the reads: every local query reaches our rows through the account's
 * *current* puuid, either as a bound parameter or as the correlated subquery in
 * recordings.repo, so there is no join site that can be missed here and no query
 * that needs to learn about the old value.
 *
 * `matches.raw_json` is rewritten alongside. Migrations 002, 004 and 006 all
 * backfill new columns by correlating a participant row back to its entry in
 * the payload on puuid; leaving the payloads alone would break that correlation
 * for precisely our own rows, and the failure would not show up until whichever
 * migration is written next quietly filled a column with nulls. A literal
 * replace covers both places the payload carries it — the participant objects
 * under $.info and the id list under $.metadata.
 *
 * Both collisions below are impossible through the app as it stands — a stored
 * match is never re-fetched, and an account is resolved before it is inserted —
 * which is exactly why they throw rather than being absorbed by an OR IGNORE.
 * If one ever happens the database is not what this function assumes, and
 * finding that out from an error beats finding it out from a silently halved
 * match history.
 */
export function rekeyAccountPuuid(
  db: DatabaseSync,
  accountId: number,
  oldPuuid: string,
  newPuuid: string
): RekeyResult {
  if (oldPuuid === newPuuid) return { matches: 0, participants: 0 }

  const taken = db
    .prepare('SELECT id FROM accounts WHERE puuid = ? AND id != ?')
    .get(newPuuid, accountId) as unknown as { id: number } | undefined
  if (taken) {
    throw new Error(`Cannot rekey account ${accountId}: account ${taken.id} already holds that puuid`)
  }

  const collision = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM match_participants mine
         JOIN match_participants theirs
           ON theirs.match_id = mine.match_id AND theirs.puuid = ?
        WHERE mine.puuid = ?`
    )
    .get(newPuuid, oldPuuid) as unknown as { n: number }
  if (collision.n > 0) {
    throw new Error(
      `Cannot rekey account ${accountId}: ${collision.n} match(es) already hold a row for the new puuid`
    )
  }

  db.exec('BEGIN')
  try {
    // Before the participant rows move, while the old puuid still selects them.
    const matches = db
      .prepare(
        `UPDATE matches
            SET raw_json = replace(raw_json, ?, ?)
          WHERE match_id IN (SELECT match_id FROM match_participants WHERE puuid = ?)`
      )
      .run(oldPuuid, newPuuid, oldPuuid)

    const participants = db
      .prepare('UPDATE match_participants SET puuid = ? WHERE puuid = ?')
      .run(newPuuid, oldPuuid)

    db.prepare(`UPDATE accounts SET puuid = ?, updated_at = datetime('now') WHERE id = ?`).run(
      newPuuid,
      accountId
    )
    db.prepare('INSERT OR IGNORE INTO account_puuids (account_id, puuid) VALUES (?, ?)').run(
      accountId,
      oldPuuid
    )

    db.exec('COMMIT')
    return { matches: Number(matches.changes), participants: Number(participants.changes) }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** The puuids this account held under earlier API keys, oldest first. */
export function listRetiredPuuids(db: DatabaseSync, accountId: number): string[] {
  const rows = db
    .prepare('SELECT puuid FROM account_puuids WHERE account_id = ? ORDER BY retired_at, puuid')
    .all(accountId) as unknown as Array<{ puuid: string }>
  return rows.map((row) => row.puuid)
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
