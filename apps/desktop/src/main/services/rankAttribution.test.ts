import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { attributeInterval, replayAttribution } from './rankAttribution'
import { getMatchSummaries, insertMatch } from '../db/repositories/matches.repo'
import { insertRankSnapshot, upsertMatchRank } from '../db/repositories/rankHistory.repo'
import { applyAllMigrations, migrationNames, migrationSql } from '../db/testMigrations'
import type { MatchDto } from '../riot/types'
import type { RankSnapshot, Season } from '@shared/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const ME = 'puuid-me'
const SOLO = 'RANKED_SOLO_5x5' as const
const T0 = 1_700_000_000_000
const ACCOUNT = 1

/**
 * Season 2026 as migration 008 seeds it, then a preseason that carries rank
 * forward and a 2027 season that resets. The middle row is the one that proves
 * the guard keys on the reset and not on the boundary.
 */
const SEASONS: Season[] = [
  {
    id: 1,
    label: 'Season 2026',
    startsAt: new Date(2026, 0, 8).getTime(),
    isPreseason: false,
    resetsRank: true
  },
  {
    id: 2,
    label: 'Preseason 2027',
    startsAt: new Date(2026, 11, 22).getTime(),
    isPreseason: true,
    resetsRank: false
  },
  {
    id: 3,
    label: 'Season 2027',
    startsAt: new Date(2027, 0, 8).getTime(),
    isPreseason: false,
    resetsRank: true
  }
]

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
    capturedAt,
    seasonId: null
  }
}

/** The length of every fixture game, in seconds as match-v5 reports it. */
const GAME_SECONDS = 1669

/** Minutes after T0, for the timelines laid out like a real evening. */
const min = (minutes: number): number => T0 + Math.round(minutes * 60_000)

/**
 * A game that ended at `endedAt`, which is where attribution places it — so the
 * timestamps throughout name ends, and each creation sits a game's length
 * earlier.
 */
function match(matchId: string, endedAt: number, queueId = 420): MatchDto {
  return {
    metadata: { matchId, participants: [ME] },
    info: {
      gameCreation: endedAt - GAME_SECONDS * 1000,
      gameDuration: GAME_SECONDS,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      queueId,
      platformId: 'NA1',
      participants: [
        {
          puuid: ME,
          riotIdGameName: 'Faker',
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
      'Faker',
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
      'Faker',
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

  /**
   * The shape of a real incident: two ranked games in a row, each recorded as
   * worth 0 LP when they were in fact worth -7 and +21.
   *
   * The cause was upstream of attribution — the watcher forced a snapshot the
   * moment the game ended, and the client was still serving the pre-game rank —
   * but these two tests are where the cost is visible, and they are why
   * rankSettling exists. Positions are Platinum IV at 7, 0 and 21 LP.
   */
  describe('a reading taken before the client caught up', () => {
    const LOSS = T0 + 1000
    const WIN = T0 + 4000

    function deltas(): Record<string, number | null | undefined> {
      return Object.fromEntries(
        getMatchSummaries(db, ME, 20, 0).map((m) => [m.matchId, m.rank?.lpDelta ?? null])
      )
    }

    it('costs both games their LP when the stale reading is stored', () => {
      insertMatch(db, match('NA1_LOSS', LOSS))
      insertMatch(db, match('NA1_WIN', WIN))

      storeSnapshot(7, T0, 1607)
      // Forced as the loss ended, still reporting the rank it started with.
      storeSnapshot(7, T0 + 2000, 1607)
      storeSnapshot(0, T0 + 3000, 1600)
      // And again as the win ended.
      storeSnapshot(0, T0 + 5000, 1600)
      storeSnapshot(21, T0 + 6000, 1621)

      replayAttribution(db, ACCOUNT, ME)

      // Each game is bracketed by two identical readings, so it measures as 0.
      // The real movement lands in the interval that follows, which holds no
      // game at all and is therefore thrown away — and because attribution is
      // replayed from the snapshots on every launch, the 0 comes back however
      // often it is cleared.
      expect(deltas()).toEqual({ NA1_LOSS: 0, NA1_WIN: 0 })
    })

    it('attributes both games once the reading is left to settle', () => {
      insertMatch(db, match('NA1_LOSS', LOSS))
      insertMatch(db, match('NA1_WIN', WIN))

      // The same polls, minus the two the watcher no longer forces early.
      storeSnapshot(7, T0, 1607)
      storeSnapshot(0, T0 + 3000, 1600)
      storeSnapshot(21, T0 + 6000, 1621)

      replayAttribution(db, ACCOUNT, ME)

      expect(deltas()).toEqual({ NA1_LOSS: -7, NA1_WIN: 21 })
    })
  })

  /**
   * Three games of an evening, each running 27 minutes and ending at 30, 70 and
   * 110. A sync that runs mid-game reads the rank the player went in with, and
   * those readings land after the game began — which is what placing a game by
   * its creation got wrong.
   */
  describe('a reading taken while a game was being played', () => {
    function evening(): void {
      insertMatch(db, match('NA1_A', min(30)))
      insertMatch(db, match('NA1_B', min(70)))
      insertMatch(db, match('NA1_C', min(110)))
    }

    /** Stored as it came, with its ladder position stamped from the rank. */
    function reading(tier: string, rank: string, lp: number, capturedAt: number): void {
      insertRankSnapshot(
        db,
        ACCOUNT,
        { queueType: SOLO, tier, rank, leaguePoints: lp, wins: 10, losses: 8 },
        'lcu',
        capturedAt,
        true
      )
    }

    function deltas(): Record<string, number | null | undefined> {
      return Object.fromEntries(
        getMatchSummaries(db, ME, 20, 0).map((m) => [m.matchId, m.rank?.lpDelta ?? null])
      )
    }

    it('does not close the game it was taken during', () => {
      // The reported case, from a server's own rows. Silver II 80 and Silver I
      // 10 were typed in for A and B; a sync read Silver II 80 during B and
      // Silver I 10 during C. Paired by creation, B and C both read 0 — each met
      // the reading taken during it, which matched the entry before it — while
      // the editor showed +30 for each.
      evening()
      reading('SILVER', 'II', 90, T0)
      reading('SILVER', 'II', 80, min(30))
      reading('SILVER', 'II', 80, min(50))
      reading('SILVER', 'I', 10, min(70))
      reading('SILVER', 'I', 10, min(85))
      reading('SILVER', 'I', 40, min(140))

      replayAttribution(db, ACCOUNT, ME)

      expect(deltas()).toEqual({ NA1_A: -10, NA1_B: 30, NA1_C: 30 })
    })

    it('does not hand a game the movement of the one before it', () => {
      // No hand entry at all: only readings from syncs that each happened to run
      // during the next game. By creation, A and B shared the first interval and
      // got nothing, and C was handed B's +25.
      evening()
      reading('SILVER', 'II', 90, T0)
      reading('SILVER', 'II', 80, min(50))
      reading('SILVER', 'I', 5, min(85))
      reading('SILVER', 'I', 25, min(140))

      replayAttribution(db, ACCOUNT, ME)

      expect(deltas()).toEqual({ NA1_A: -10, NA1_B: 25, NA1_C: 20 })
    })

    it('is closed by a reading exactly at its end and not one just before', () => {
      // A hand-entered rank is stored at exactly the game's end, so that instant
      // has to close the game. A millisecond earlier the game is still being
      // played, and it shares the next interval with B.
      insertMatch(db, match('NA1_A', min(30)))
      insertMatch(db, match('NA1_B', min(70)))
      reading('GOLD', 'II', 20, T0)
      reading('GOLD', 'II', 41, min(30))
      reading('GOLD', 'II', 62, min(100))

      replayAttribution(db, ACCOUNT, ME)
      expect(deltas()).toEqual({ NA1_A: 21, NA1_B: 21 })

      db.exec('DELETE FROM match_rank')
      db.prepare('UPDATE rank_snapshots SET captured_at = ? WHERE captured_at = ?').run(
        min(30) - 1,
        min(30)
      )

      replayAttribution(db, ACCOUNT, ME)
      expect(deltas()).toEqual({ NA1_A: null, NA1_B: null })
    })
  })
})

describe('upgrading to games placed by their end (migration 015)', () => {
  it('drops a figure the old rule proved and the new one cannot', () => {
    const db = new DatabaseSync(':memory:')
    for (const name of migrationNames().filter((n) => n < '015')) db.exec(migrationSql(name))
    db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(
      ME,
      'Faker',
      'NA1'
    )

    insertMatch(db, match('NA1_A', min(30)))
    insertMatch(db, match('NA1_B', min(70)))
    insertMatch(db, match('NA1_C', min(110)))
    for (const [rank, lp, at] of [
      ['II', 90, T0],
      ['II', 80, min(50)],
      ['I', 25, min(140)]
    ] as const) {
      insertRankSnapshot(
        db,
        ACCOUNT,
        { queueType: SOLO, tier: 'SILVER', rank, leaguePoints: lp, wins: 10, losses: 8 },
        'lcu',
        at,
        true
      )
    }

    // What placing games by creation wrote: C alone after the reading taken
    // during B, handed B's movement along with its own.
    upsertMatchRank(db, {
      matchId: 'NA1_C',
      accountId: ACCOUNT,
      queueType: SOLO,
      tierBefore: 'SILVER',
      rankBefore: 'II',
      lpBefore: 80,
      tierAfter: 'SILVER',
      rankAfter: 'I',
      lpAfter: 25,
      lpDelta: 45,
      isPromotion: true,
      isDemotion: false
    })

    const deltas = (): Record<string, number | null> =>
      Object.fromEntries(
        getMatchSummaries(db, ME, 20, 0).map((m) => [m.matchId, m.rank?.lpDelta ?? null])
      )

    // A replay only upserts. B and C now share an interval, so it proves
    // neither — and has no way to take back what it proved last time.
    replayAttribution(db, ACCOUNT, ME)
    expect(deltas()).toEqual({ NA1_A: -10, NA1_B: null, NA1_C: 45 })

    db.exec(migrationSql('015_attribution_by_game_end.sql'))
    replayAttribution(db, ACCOUNT, ME)

    expect(deltas()).toEqual({ NA1_A: -10, NA1_B: null, NA1_C: null })
  })
})

describe('the ladder reset', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(
      ME,
      'Faker',
      'NA1'
    )
    // Migration 008 seeds Season 2026 only; the boundary under test is the one
    // after it. replayAttribution reads these back out of the database.
    for (const s of SEASONS.slice(1)) {
      db.prepare(
        'INSERT INTO seasons (id, label, starts_at, is_preseason, resets_rank) VALUES (?, ?, ?, ?, ?)'
      ).run(s.id, s.label, s.startsAt, s.isPreseason ? 1 : 0, s.resetsRank ? 1 : 0)
    }
  })

  // Local time, matching how a hand-entered boundary is stored.
  const DEC = new Date(2026, 11, 28, 20).getTime()
  const JAN = new Date(2027, 0, 8, 14).getTime()

  // Real ladder positions: Emerald II 20 LP against Bronze IV 0 LP is a 1,820
  // point fall, which is the number that would land on the game beside it.
  const EMERALD_II = 2220
  const BRONZE_IV = 400

  it('refuses to attribute the annual reset to the one game beside it', () => {
    // The exact shape that would otherwise poison a match forever: a December
    // reading, a January one after the reset, and a single ranked game between
    // them for the delta to land on.
    insertMatch(db, match('NA1_1', JAN - 3_600_000))

    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('EMERALD', 'II', 20, DEC, EMERALD_II),
      snapshot('BRONZE', 'IV', 0, JAN, BRONZE_IV),
      SEASONS
    )

    expect(wrote).toBe(false)
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toBe(null)
    expect(db.prepare('SELECT COUNT(*) AS c FROM match_rank').get()).toMatchObject({ c: 0 })
  })

  it('still attributes normally on either side of the boundary', () => {
    // The guard must be narrow: two readings inside the same year attribute as
    // they always did, even in the days right before a reset.
    insertMatch(db, match('NA1_1', DEC + 500))

    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('EMERALD', 'II', 20, DEC, EMERALD_II),
      snapshot('EMERALD', 'II', 41, DEC + 1000, EMERALD_II + 21),
      SEASONS
    )

    expect(wrote).toBe(true)
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toMatchObject({ lpDelta: 21 })
  })

  it('still attributes across a boundary that carried rank forward', () => {
    // Into the preseason: a real period boundary, but the ladder was not
    // emptied, so the game between these two readings earned its LP and must
    // keep it. Suppressing here would be a silent false negative.
    const before = new Date(2026, 11, 20, 20).getTime()
    const after = new Date(2026, 11, 24, 20).getTime()
    insertMatch(db, match('NA1_1', before + 1000))

    const wrote = attributeInterval(
      db,
      ACCOUNT,
      ME,
      SOLO,
      snapshot('EMERALD', 'II', 20, before, EMERALD_II),
      snapshot('EMERALD', 'II', 41, after, EMERALD_II + 21),
      SEASONS
    )

    expect(wrote).toBe(true)
    expect(getMatchSummaries(db, ME, 20, 0)[0].rank).toMatchObject({ lpDelta: 21 })
  })

  it('survives repeated unbounded replays, which is how the chip used to return', () => {
    // repairAttribution runs replayAttribution unbounded on every launch, so a
    // guard that only held on the first pass would be no guard at all.
    insertRankSnapshot(
      db,
      ACCOUNT,
      { queueType: SOLO, tier: 'EMERALD', rank: 'II', leaguePoints: 20, wins: 90, losses: 70 },
      'lcu',
      DEC,
      true
    )
    insertRankSnapshot(
      db,
      ACCOUNT,
      { queueType: SOLO, tier: 'BRONZE', rank: 'IV', leaguePoints: 0, wins: 1, losses: 0 },
      'lcu',
      JAN,
      true
    )
    insertMatch(db, match('NA1_1', JAN - 3_600_000))

    expect(replayAttribution(db, ACCOUNT, ME)).toBe(0)
    expect(replayAttribution(db, ACCOUNT, ME)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS c FROM match_rank').get()).toMatchObject({ c: 0 })
  })
})
