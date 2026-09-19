import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAccountById, listRetiredPuuids, rekeyAccountPuuid } from './accounts.repo'
import { insertMatch } from './matches.repo'
import { applyAllMigrations } from '../testMigrations'
import type { MatchDto } from '../../riot/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

/** The puuid the old API key issued, and the one a new key issues for the same player. */
const OLD = 'puuid-old-key'
const NEW = 'puuid-new-key'
const THEM = 'puuid-someone-else'

function participant(puuid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    puuid,
    riotIdGameName: 'Someone',
    riotIdTagline: 'NA1',
    teamId: 100,
    win: true,
    championId: 112,
    championName: 'Viktor',
    champLevel: 15,
    kills: 2,
    deaths: 4,
    assists: 4,
    goldEarned: 11_000,
    totalMinionsKilled: 200,
    neutralMinionsKilled: 43,
    totalDamageDealtToChampions: 18_900,
    totalDamageTaken: 20_100,
    item0: 1056,
    item1: 3157,
    item2: 3100,
    item3: 2503,
    item4: 3067,
    item5: 3089,
    item6: 3340,
    summoner1Id: 12,
    summoner2Id: 4,
    teamPosition: 'MIDDLE',
    largestMultiKill: 2,
    gameEndedInEarlySurrender: false,
    roleBoundItem: 1206,
    perks: { statPerks: {}, styles: [] },
    ...overrides
  }
}

function match(matchId: string, puuids: string[]): MatchDto {
  const participants = puuids.map((puuid) => participant(puuid))
  return {
    metadata: { matchId, participants: puuids },
    info: {
      gameCreation: 1_700_000_000_000,
      gameDuration: 1669,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      queueId: 420,
      platformId: 'NA1',
      participants
    }
  } as unknown as MatchDto
}

function insertAccountRow(db: DatabaseSyncType, puuid: string, gameName = 'Faker'): number {
  const result = db
    .prepare(
      `INSERT INTO accounts (puuid, game_name, tag_line, platform, regional_route)
       VALUES (?, ?, 'NA1', 'na1', 'americas')`
    )
    .run(puuid, gameName)
  return Number(result.lastInsertRowid)
}

/**
 * The correlation migrations 002, 004 and 006 use to backfill a column from the
 * stored payload. Asserted directly, because it is the thing a rekey can break
 * without any test of the app's own queries noticing.
 */
function rowsCorrelatingToRawJson(db: DatabaseSyncType, puuid: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM match_participants p
        WHERE p.puuid = ?
          AND EXISTS (
                SELECT 1
                  FROM matches m,
                       json_each(json_extract(m.raw_json, '$.info.participants')) AS participant
                 WHERE m.match_id = p.match_id
                   AND json_extract(participant.value, '$.puuid') = p.puuid
              )`
    )
    .get(puuid) as unknown as { n: number }
  return row.n
}

describe('rekeyAccountPuuid', () => {
  let db: DatabaseSyncType
  let accountId: number

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    accountId = insertAccountRow(db, OLD)
    insertMatch(db, match('NA1_1', [OLD, THEM]))
    insertMatch(db, match('NA1_2', [OLD, THEM]))
    // A game we were not in, to prove the rewrite is scoped to our own rows.
    insertMatch(db, match('NA1_3', [THEM, 'puuid-third']))
  })

  it('moves the account and its participant rows onto the new puuid', () => {
    const moved = rekeyAccountPuuid(db, accountId, OLD, NEW)

    expect(moved).toEqual({ matches: 2, participants: 2 })
    expect(getAccountById(db, accountId)?.puuid).toBe(NEW)
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM match_participants WHERE puuid = ?').get(NEW) as
        unknown as { n: number }).n
    ).toBe(2)
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM match_participants WHERE puuid = ?').get(OLD) as
        unknown as { n: number }).n
    ).toBe(0)
  })

  it('leaves every other player alone', () => {
    rekeyAccountPuuid(db, accountId, OLD, NEW)

    const theirs = db
      .prepare('SELECT COUNT(*) AS n FROM match_participants WHERE puuid = ?')
      .get(THEM) as unknown as { n: number }
    expect(theirs.n).toBe(3)
  })

  it('rewrites the stored payloads so they still correlate to the participant rows', () => {
    expect(rowsCorrelatingToRawJson(db, OLD)).toBe(2)

    rekeyAccountPuuid(db, accountId, OLD, NEW)

    expect(rowsCorrelatingToRawJson(db, NEW)).toBe(2)
    expect(rowsCorrelatingToRawJson(db, OLD)).toBe(0)
  })

  it('rewrites the id list in the payload metadata too', () => {
    rekeyAccountPuuid(db, accountId, OLD, NEW)

    const row = db.prepare("SELECT raw_json FROM matches WHERE match_id = 'NA1_1'").get() as
      unknown as { raw_json: string }
    const stored = JSON.parse(row.raw_json) as { metadata: { participants: string[] } }
    expect(stored.metadata.participants).toContain(NEW)
    expect(stored.metadata.participants).not.toContain(OLD)
  })

  it('leaves payloads we do not appear in untouched', () => {
    const before = db.prepare("SELECT raw_json FROM matches WHERE match_id = 'NA1_3'").get() as
      unknown as { raw_json: string }

    rekeyAccountPuuid(db, accountId, OLD, NEW)

    const after = db.prepare("SELECT raw_json FROM matches WHERE match_id = 'NA1_3'").get() as
      unknown as { raw_json: string }
    expect(after.raw_json).toBe(before.raw_json)
  })

  it('records the retired puuid', () => {
    rekeyAccountPuuid(db, accountId, OLD, NEW)

    expect(listRetiredPuuids(db, accountId)).toEqual([OLD])
  })

  it('does nothing when the key hands back the same puuid', () => {
    const moved = rekeyAccountPuuid(db, accountId, OLD, OLD)

    expect(moved).toEqual({ matches: 0, participants: 0 })
    expect(listRetiredPuuids(db, accountId)).toEqual([])
  })

  it('refuses to rekey onto a puuid another account already holds', () => {
    const other = insertAccountRow(db, NEW, 'Someone Else')

    expect(() => rekeyAccountPuuid(db, accountId, OLD, NEW)).toThrow(String(other))
    expect(getAccountById(db, accountId)?.puuid).toBe(OLD)
  })

  it('refuses when a match already holds a row for the new puuid, and changes nothing', () => {
    // Only reachable if a match were stored twice under both identities. It
    // would trip UNIQUE(match_id, puuid), so it must abort before writing.
    insertMatch(db, match('NA1_4', [OLD, NEW]))

    expect(() => rekeyAccountPuuid(db, accountId, OLD, NEW)).toThrow(/already hold a row/)
    expect(getAccountById(db, accountId)?.puuid).toBe(OLD)
    expect(rowsCorrelatingToRawJson(db, OLD)).toBe(3)
  })
})
