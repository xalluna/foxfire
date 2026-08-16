import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { attributeInterval, replayAttribution } from './rankAttribution'
import { getMatchSummaries, insertMatch } from '../db/repositories/matches.repo'
import { insertRankSnapshot } from '../db/repositories/rankHistory.repo'
import { applyAllMigrations } from '../db/testMigrations'
import type { MatchDto } from '../riot/types'
import type { RankSnapshot } from '@shared/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const ME = 'puuid-me'
const SOLO = 'RANKED_SOLO_5x5' as const
const T0 = 1_700_000_000_000
const ACCOUNT = 1

function snapshot(
  tier: string,
  rank: string,
  lp: number,
  capturedAt: number,
  ladderPosition: number | null
): RankSnapshot {
  return {
    queueType: SOLO,
    tier,
    rank,
    leaguePoints: lp,
    wins: 10,
    losses: 8,
    ladderPosition,
    source: 'lcu',
    capturedAt
  }
}

function match(matchId: string, gameCreation: number, queueId = 420): MatchDto {
  return {
    metadata: { matchId, participants: [ME] },
    info: {
      gameCreation,
      gameDuration: 1669,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      queueId,
      platformId: 'NA1',
      participants: [
        {
          puuid: ME,
          riotIdGameName: 'Alluna',
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
          perks: { statPerks: {}, styles: [] }
        }
      ]
    }
  } as unknown as MatchDto
}

describe('attributeInterval', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(
      ME,
      'Alluna',
      'NA1'
    )
  })

  it('attributes the full delta when exactly one game sits in the interval', () => {
    insertMatch(db, match('NA1_1', T0 + 500))

    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('GOLD', 'II', 20, T0, 1420),
      snapshot('GOLD', 'II', 41, T0 + 1000, 1441)
    )

    expect(wrote).toBe(true)
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toMatchObject({
      lpDelta: 21,
      isPromotion: false,
      isDemotion: false
    })
  })

  it('writes nothing when several games share the interval', () => {
    insertMatch(db, match('NA1_1', T0 + 200))
    insertMatch(db, match('NA1_2', T0 + 400))

    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('GOLD', 'II', 20, T0, 1420),
      snapshot('GOLD', 'II', 61, T0 + 1000, 1461)
    )

    // The 41 LP could have split any number of ways between the two games, so
    // it is left unattributed rather than guessed at.
    expect(wrote).toBe(false)
    expect(getMatchSummaries(db, ME, 20, 0).every((m) => m.rank === null)).toBe(true)
  })

  it('writes nothing when no game explains the movement', () => {
    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('GOLD', 'II', 20, T0, 1420),
      snapshot('GOLD', 'II', 41, T0 + 1000, 1441)
    )
    expect(wrote).toBe(false)
  })

  it('ignores games from another queue', () => {
    insertMatch(db, match('NA1_aram', T0 + 500, 450))

    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('GOLD', 'II', 20, T0, 1420),
      snapshot('GOLD', 'II', 41, T0 + 1000, 1441)
    )
    expect(wrote).toBe(false)
  })

  it('computes the delta across a division boundary', () => {
    insertMatch(db, match('NA1_1', T0 + 500))

    attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('GOLD', 'III', 95, T0, 1395),
      snapshot('GOLD', 'II', 12, T0 + 1000, 1412)
    )

    // Raw LP would read as 12 - 95 = -83 for what was actually a 17 LP win.
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toMatchObject({
      lpDelta: 17,
      isPromotion: true,
      isDemotion: false
    })
  })

  it('flags a demotion across a division boundary', () => {
    insertMatch(db, match('NA1_1', T0 + 500))

    attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('GOLD', 'II', 3, T0, 1403),
      snapshot('GOLD', 'III', 75, T0 + 1000, 1375)
    )

    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toMatchObject({
      lpDelta: -28,
      isPromotion: false,
      isDemotion: true
    })
  })

  it('skips an interval where either side was unranked', () => {
    insertMatch(db, match('NA1_1', T0 + 500))

    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('GOLD', 'II', 20, T0, null),
      snapshot('GOLD', 'II', 41, T0 + 1000, 1441)
    )
    expect(wrote).toBe(false)
  })
})

describe('replayAttribution', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(
      ME,
      'Alluna',
      'NA1'
    )
  })

  /** Writes a stored snapshot directly, bypassing the dedupe and the service layer. */
  function storeSnapshot(lp: number, capturedAt: number, ladderPosition: number): void {
    insertRankSnapshot(
      db,
      ACCOUNT,
      { queueType: SOLO, tier: 'GOLD', rank: 'II', leaguePoints: lp, wins: 10, losses: 8 },
      'lcu',
      capturedAt,
      true
    )
    // ladder_position is stamped from tier/rank/LP on write, so the fixture's
    // intended position has to be applied afterwards to keep these tests
    // independent of the ladder maths, which ladder.test.ts already covers.
    db.prepare(
      'UPDATE rank_snapshots SET ladder_position = ? WHERE account_id = ? AND captured_at = ?'
    ).run(ladderPosition, ACCOUNT, capturedAt)
  }

  it('attributes a game that only arrived after both snapshots were taken', () => {
    // The real ordering: the client reports the new LP within a minute of the
    // game ending, and Riot publishes the match minutes later. Inline
    // attribution at snapshot time therefore always found nothing.
    storeSnapshot(20, T0, 1420)
    storeSnapshot(41, T0 + 1000, 1441)

    expect(getMatchSummaries(db, ME, 20, 0).length).toBe(0)

    insertMatch(db, match('NA1_1', T0 + 500))
    expect(replayAttribution(db, ACCOUNT, ME)).toBe(1)

    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toMatchObject({ lpDelta: 21 })
  })

  it('walks every interval, not just the most recent', () => {
    storeSnapshot(20, T0, 1420)
    storeSnapshot(41, T0 + 1000, 1441)
    storeSnapshot(23, T0 + 2000, 1423)

    insertMatch(db, match('NA1_1', T0 + 500))
    insertMatch(db, match('NA1_2', T0 + 1500))

    expect(replayAttribution(db, ACCOUNT, ME)).toBe(2)

    const rows = getMatchSummaries(db, ME, 20, 0)
    expect(rows.find((m) => m.matchId === 'NA1_1')?.rank).toMatchObject({ lpDelta: 21 })
    expect(rows.find((m) => m.matchId === 'NA1_2')?.rank).toMatchObject({ lpDelta: -18 })
  })

  it('is idempotent — a second pass changes nothing', () => {
    storeSnapshot(20, T0, 1420)
    storeSnapshot(41, T0 + 1000, 1441)
    insertMatch(db, match('NA1_1', T0 + 500))

    replayAttribution(db, ACCOUNT, ME)
    replayAttribution(db, ACCOUNT, ME)

    expect(db.prepare('SELECT COUNT(*) AS c FROM match_rank').get()).toMatchObject({ c: 1 })
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toMatchObject({ lpDelta: 21 })
  })

  it('leaves an ambiguous interval alone however often it runs', () => {
    storeSnapshot(20, T0, 1420)
    storeSnapshot(61, T0 + 1000, 1461)
    insertMatch(db, match('NA1_1', T0 + 200))
    insertMatch(db, match('NA1_2', T0 + 400))

    expect(replayAttribution(db, ACCOUNT, ME)).toBe(0)
    expect(getMatchSummaries(db, ME, 20, 0).every((m) => m.rank === null)).toBe(true)
  })

  it('honours the time window, ignoring intervals older than it', () => {
    storeSnapshot(20, T0, 1420)
    storeSnapshot(41, T0 + 1000, 1441)
    insertMatch(db, match('NA1_1', T0 + 500))

    // A window opening after both snapshots leaves fewer than two readings to
    // pair up, so there is no interval to attribute.
    expect(replayAttribution(db, ACCOUNT, ME, T0 + 5000)).toBe(0)
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toBe(null)
  })
})
