import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { getMatchSummaries, insertMatch } from './matches.repo'
import type { MatchDto } from '../../riot/types'

// Loaded through require rather than a static import: Vite strips the `node:`
// prefix during transform and then fails to resolve the bare `sqlite`
// specifier, which is not a real package. The rest of the main process only
// ever imports DatabaseSync as a type, so this is the one place it bites.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

// Read off disk rather than via Vite's `?raw` import so the tests exercise the
// exact SQL the app ships without needing the renderer plugin chain.
const migration = (name: string): string =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8')

const ME = 'puuid-me'

function participant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    puuid: 'puuid-other',
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
    item5: 3363,
    item6: 3009,
    summoner1Id: 12,
    summoner2Id: 4,
    teamPosition: 'MIDDLE',
    largestMultiKill: 2,
    perks: { statPerks: {}, styles: [] },
    ...overrides
  }
}

/** Two teams of one; enough to prove the team-aggregate join groups correctly. */
function match(matchId: string, participants: Array<Record<string, unknown>>): MatchDto {
  return {
    metadata: { matchId, participants: participants.map((p) => p.puuid as string) },
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

describe('getMatchSummaries', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec(migration('001_init.sql'))
    db.exec(migration('002_match_stats.sql'))
  })

  it('returns the full per-row stat set from a single query', () => {
    insertMatch(
      db,
      match('NA1_1', [
        participant({ puuid: ME, kills: 2, assists: 4 }),
        participant({ puuid: 'puuid-b', teamId: 200, win: false })
      ])
    )

    const [row] = getMatchSummaries(db, ME, 20, 0)

    expect(row.championName).toBe('Viktor')
    expect(row.champLevel).toBe(15)
    expect(row.cs).toBe(243) // minions + neutral, summed on insert
    expect(row.goldEarned).toBe(11_000)
    expect(row.damageDealtToChampions).toBe(18_900)
    expect(row.largestMultiKill).toBe(2)
    expect(row.teamPosition).toBe('MIDDLE')
    // Six inventory slots plus the trinket in slot 6.
    expect(row.items).toEqual([1056, 3157, 3100, 2503, 3067, 3363, 3009])
    expect(row.summoner1Id).toBe(12)
  })

  it('aggregates kills and damage over the player’s own team only', () => {
    insertMatch(
      db,
      match('NA1_1', [
        participant({ puuid: ME, kills: 2, totalDamageDealtToChampions: 10_000 }),
        participant({ puuid: 'ally', kills: 8, totalDamageDealtToChampions: 30_000 }),
        // The enemy team's much larger numbers must not leak into the totals.
        participant({
          puuid: 'enemy',
          teamId: 200,
          win: false,
          kills: 99,
          totalDamageDealtToChampions: 999_000
        })
      ])
    )

    const [row] = getMatchSummaries(db, ME, 20, 0)

    expect(row.teamKills).toBe(10)
    expect(row.teamDamage).toBe(40_000)
  })

  it('orders newest first and honours limit and offset', () => {
    for (const [i, id] of ['NA1_1', 'NA1_2', 'NA1_3'].entries()) {
      const dto = match(id, [participant({ puuid: ME })])
      dto.info.gameCreation = 1_700_000_000_000 + i * 1000
      insertMatch(db, dto)
    }

    expect(getMatchSummaries(db, ME, 2, 0).map((m) => m.matchId)).toEqual(['NA1_3', 'NA1_2'])
    expect(getMatchSummaries(db, ME, 2, 2).map((m) => m.matchId)).toEqual(['NA1_1'])
  })

  it('tolerates a match with no multi-kill recorded', () => {
    insertMatch(db, match('NA1_1', [participant({ puuid: ME, largestMultiKill: undefined })]))
    expect(getMatchSummaries(db, ME, 20, 0)[0].largestMultiKill).toBeNull()
  })
})

describe('002 backfill', () => {
  it('recovers largest_multi_kill from raw_json for matches stored before the column existed', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(migration('001_init.sql'))

    // Insert under the 001 schema, exactly as a pre-upgrade install would have.
    insertMatchWithoutMultiKill(
      db,
      match('NA1_1', [
        participant({ puuid: ME, largestMultiKill: 3 }),
        participant({ puuid: 'ally', largestMultiKill: 5 })
      ])
    )

    db.exec(migration('002_match_stats.sql'))

    // Matched back by puuid, not array position.
    expect(getMatchSummaries(db, ME, 20, 0)[0].largestMultiKill).toBe(3)
    expect(getMatchSummaries(db, 'ally', 20, 0)[0].largestMultiKill).toBe(5)
  })
})

/** Replays the 001-era insert so the backfill has genuinely null columns to fill. */
function insertMatchWithoutMultiKill(db: DatabaseSyncType, dto: MatchDto): void {
  db.prepare(
    `INSERT INTO matches (match_id, game_creation, game_duration, game_mode, game_type, queue_id, platform_id, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    dto.metadata.matchId,
    dto.info.gameCreation,
    dto.info.gameDuration,
    dto.info.gameMode,
    dto.info.gameType,
    dto.info.queueId,
    dto.info.platformId,
    JSON.stringify(dto)
  )

  for (const p of dto.info.participants) {
    db.prepare(
      `INSERT INTO match_participants
         (match_id, puuid, team_id, win, champion_id, champion_name, kills, deaths, assists,
          damage_dealt_to_champions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      dto.metadata.matchId,
      p.puuid,
      p.teamId,
      p.win ? 1 : 0,
      p.championId,
      p.championName,
      p.kills,
      p.deaths,
      p.assists,
      p.totalDamageDealtToChampions
    )
  }
}
