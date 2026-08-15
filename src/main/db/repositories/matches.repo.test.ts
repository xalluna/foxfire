import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { getChampionWinRates, getMatchSummaries, insertMatch } from './matches.repo'
import { applyAllMigrations, migrationNames, migrationSql } from '../testMigrations'
import type { MatchDto } from '../../riot/types'

// Loaded through require rather than a static import: Vite strips the `node:`
// prefix during transform and then fails to resolve the bare `sqlite`
// specifier, which is not a real package. The rest of the main process only
// ever imports DatabaseSync as a type, so this is the one place it bites.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

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
function match(
  matchId: string,
  participants: Array<Record<string, unknown>>,
  queueId = 420
): MatchDto {
  return {
    metadata: { matchId, participants: participants.map((p) => p.puuid as string) },
    info: {
      gameCreation: 1_700_000_000_000,
      gameDuration: 1669,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      queueId,
      platformId: 'NA1',
      participants
    }
  } as unknown as MatchDto
}

describe('getMatchSummaries', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
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

  it('carries no LP data when the game was never attributed', () => {
    insertMatch(db, match('NA1_1', [participant({ puuid: ME })]))
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toBeNull()
  })
})

describe('getMatchSummaries queue filter', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)

    // One game in each of solo, flex and ARAM, newest first by queue order.
    for (const [i, queueId] of [420, 440, 450].entries()) {
      const dto = match(`NA1_${queueId}`, [participant({ puuid: ME })], queueId)
      dto.info.gameCreation = 1_700_000_000_000 + i * 1000
      insertMatch(db, dto)
    }
  })

  it('returns every queue when no filter is given', () => {
    expect(getMatchSummaries(db, ME, 20, 0)).toHaveLength(3)
    expect(getMatchSummaries(db, ME, 20, 0, null)).toHaveLength(3)
  })

  it('restricts to one queue', () => {
    const solo = getMatchSummaries(db, ME, 20, 0, 420)
    expect(solo.map((m) => m.matchId)).toEqual(['NA1_420'])
    expect(getMatchSummaries(db, ME, 20, 0, 450).map((m) => m.matchId)).toEqual(['NA1_450'])
  })

  it('returns nothing for a queue with no games rather than falling back', () => {
    expect(getMatchSummaries(db, ME, 20, 0, 1700)).toEqual([])
  })

  it('pages over the filtered set, not the full one', () => {
    // Two more solo games, so solo has three of the five total.
    for (const [i, id] of ['NA1_solo2', 'NA1_solo3'].entries()) {
      const dto = match(id, [participant({ puuid: ME })], 420)
      dto.info.gameCreation = 1_700_000_100_000 + i * 1000
      insertMatch(db, dto)
    }

    // Paging after the filter is what keeps page sizes even; filtering a page
    // afterwards would have yielded one row here instead of two.
    expect(getMatchSummaries(db, ME, 2, 0, 420).map((m) => m.matchId)).toEqual([
      'NA1_solo3',
      'NA1_solo2'
    ])
    expect(getMatchSummaries(db, ME, 2, 2, 420).map((m) => m.matchId)).toEqual(['NA1_420'])
  })
})

describe('getChampionWinRates', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
  })

  it('aggregates games and wins per champion', () => {
    insertMatch(db, match('NA1_1', [participant({ puuid: ME, championId: 112, win: true })]))
    insertMatch(db, match('NA1_2', [participant({ puuid: ME, championId: 112, win: false })]))
    insertMatch(db, match('NA1_3', [participant({ puuid: ME, championId: 64, win: true })]))

    const rates = getChampionWinRates(db, ME)
    expect(rates).toEqual([
      { championId: 112, games: 2, wins: 1 },
      { championId: 64, games: 1, wins: 1 }
    ])
  })

  it('scopes the aggregate to one queue', () => {
    // Same champion, a loss in solo and two wins in ARAM. Unfiltered this reads
    // as 2/3; scoped to solo it must read as the 0/1 it actually was.
    insertMatch(db, match('NA1_1', [participant({ puuid: ME, championId: 112, win: false })], 420))
    insertMatch(db, match('NA1_2', [participant({ puuid: ME, championId: 112, win: true })], 450))
    insertMatch(db, match('NA1_3', [participant({ puuid: ME, championId: 112, win: true })], 450))

    expect(getChampionWinRates(db, ME)).toEqual([{ championId: 112, games: 3, wins: 2 }])
    expect(getChampionWinRates(db, ME, 420)).toEqual([{ championId: 112, games: 1, wins: 0 }])
    expect(getChampionWinRates(db, ME, 450)).toEqual([{ championId: 112, games: 2, wins: 2 }])
  })

  it('drops a champion entirely when it was never played in the filtered queue', () => {
    insertMatch(db, match('NA1_1', [participant({ puuid: ME, championId: 112 })], 450))
    expect(getChampionWinRates(db, ME, 420)).toEqual([])
  })

  it('excludes remakes, which carry a result but decide nothing', () => {
    insertMatch(db, match('NA1_1', [participant({ puuid: ME, championId: 112, win: false })]))
    // A remake reports a nominal win; counting it would show 50% off one real
    // game, which is the discrepancy against op.gg this rule removes.
    insertMatch(
      db,
      match('NA1_2', [
        participant({ puuid: ME, championId: 112, win: true, gameEndedInEarlySurrender: true })
      ])
    )

    expect(getChampionWinRates(db, ME)).toEqual([{ championId: 112, games: 1, wins: 0 }])
  })

  it('omits a champion played only in a remake', () => {
    insertMatch(
      db,
      match('NA1_1', [
        participant({ puuid: ME, championId: 54, gameEndedInEarlySurrender: true })
      ])
    )
    expect(getChampionWinRates(db, ME)).toEqual([])
  })
})

describe('backfills from raw_json', () => {
  /** Replays a pre-upgrade install: 001 schema, then the later migrations. */
  function upgradeFrom001(participants: Array<Record<string, unknown>>): DatabaseSyncType {
    const db = new DatabaseSync(':memory:')
    db.exec(migrationSql('001_init.sql'))
    insertMatchWithoutMultiKill(db, match('NA1_1', participants))
    for (const name of migrationNames().filter((n) => n !== '001_init.sql')) {
      db.exec(migrationSql(name))
    }
    return db
  }

  it('recovers largest_multi_kill for matches stored before the column existed', () => {
    const db = upgradeFrom001([
      participant({ puuid: ME, largestMultiKill: 3 }),
      participant({ puuid: 'ally', largestMultiKill: 5 })
    ])

    // Matched back by puuid, not array position.
    expect(getMatchSummaries(db, ME, 20, 0)[0].largestMultiKill).toBe(3)
    expect(getMatchSummaries(db, 'ally', 20, 0)[0].largestMultiKill).toBe(5)
  })

  it('recovers the remake flag, so old history stops inflating win rates', () => {
    const db = upgradeFrom001([
      participant({ puuid: ME, gameEndedInEarlySurrender: true, win: true }),
      participant({ puuid: 'ally', gameEndedInEarlySurrender: false })
    ])

    expect(getMatchSummaries(db, ME, 20, 0)[0].isRemake).toBe(true)
    expect(getMatchSummaries(db, 'ally', 20, 0)[0].isRemake).toBe(false)
    // The nominal win must not reach champion stats.
    expect(getChampionWinRates(db, ME)).toEqual([])
  })

  it('defaults to not-a-remake when the payload omits the field', () => {
    const db = upgradeFrom001([participant({ puuid: ME })])
    expect(getMatchSummaries(db, ME, 20, 0)[0].isRemake).toBe(false)
    expect(getChampionWinRates(db, ME)).toHaveLength(1)
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
