import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearManualRank,
  getEditableMatches,
  manualSnapshotTime,
  saveManualRanks,
  validateManualRank
} from './manualRankService'
import { replayAttribution } from './rankAttribution'
import { getMatchSummaries, insertMatch } from '../db/repositories/matches.repo'
import {
  deleteSupersededManualSnapshots,
  getRankSnapshots,
  insertRankSnapshot
} from '../db/repositories/rankHistory.repo'
import { applyAllMigrations } from '../db/testMigrations'
import type { MatchDto } from '../riot/types'
import type { ManualRank } from '@shared/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const ME = 'puuid-me'
const SOLO = 'RANKED_SOLO_5x5' as const
const T0 = 1_700_000_000_000
const ACCOUNT = 1
const MINUTE = 60_000
/** Seconds, as the schema stores it — 25 minutes. */
const DURATION = 1500

function match(
  matchId: string,
  gameCreation: number,
  { queueId = 420, remake = false }: { queueId?: number; remake?: boolean } = {}
): MatchDto {
  return {
    metadata: { matchId, participants: [ME] },
    info: {
      gameCreation,
      gameDuration: DURATION,
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
          gameEndedInEarlySurrender: remake,
          perks: { statPerks: {}, styles: [] }
        }
      ]
    }
  } as unknown as MatchDto
}

function rank(tier: string, division: string | null, lp: number): ManualRank {
  return { tier, rank: division, leaguePoints: lp }
}

/** A reading the app observed, as the LCU watcher would have written it. */
function observe(db: DatabaseSyncType, r: ManualRank, capturedAt: number): void {
  insertRankSnapshot(
    db,
    ACCOUNT,
    { queueType: SOLO, tier: r.tier, rank: r.rank, leaguePoints: r.leaguePoints, wins: 10, losses: 8 },
    'lcu',
    capturedAt,
    true
  )
}

function lpFor(db: DatabaseSyncType, matchId: string): number | null | undefined {
  return getMatchSummaries(db, ME, 50, 0).find((m) => m.matchId === matchId)?.rank?.lpDelta
}

/**
 * Three ranked games in one interval — the situation the editor exists for.
 * A reading before the first and after the last, and nothing in between, so
 * attribution cannot split the total and all three come out blank.
 */
function seedAmbiguousRun(db: DatabaseSyncType): void {
  observe(db, rank('GOLD', 'II', 20), T0)
  insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))
  insertMatch(db, match('NA1_B', T0 + 60 * MINUTE))
  insertMatch(db, match('NA1_C', T0 + 120 * MINUTE))
  observe(db, rank('GOLD', 'II', 71), T0 + 180 * MINUTE)
}

describe('manual LP entry', () => {
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

  describe('migration 005', () => {
    it('leaves match_id null on observed readings', () => {
      observe(db, rank('GOLD', 'II', 20), T0)
      const rows = db
        .prepare('SELECT match_id FROM rank_snapshots')
        .all() as unknown as Array<{ match_id: string | null }>

      expect(rows).toHaveLength(1)
      expect(rows[0].match_id).toBeNull()
    })
  })

  describe('getEditableMatches', () => {
    it('offers only ranked games with no LP figure, newest first', () => {
      seedAmbiguousRun(db)
      insertMatch(db, match('NA1_ARAM', T0 + 30 * MINUTE, { queueId: 450 }))
      insertMatch(db, match('NA1_REMAKE', T0 + 40 * MINUTE, { remake: true }))

      // Newest first: a gap worth fixing is nearly always a recent one, and the
      // editor should not open on games from the start of the season.
      expect(getEditableMatches(db, ACCOUNT, ME, SOLO).map((m) => m.matchId)).toEqual([
        'NA1_C',
        'NA1_B',
        'NA1_A'
      ])
    })

    it('excludes a game attribution already worked out', () => {
      observe(db, rank('GOLD', 'II', 20), T0)
      insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))
      observe(db, rank('GOLD', 'II', 41), T0 + 20 * MINUTE)
      // Snapshots alone write no LP — the real flow attributes on replay.
      replayAttribution(db, ACCOUNT, ME)

      expect(lpFor(db, 'NA1_A')).toBe(21)
      expect(getEditableMatches(db, ACCOUNT, ME, SOLO)).toEqual([])
    })

    it('keeps a game the user entered, so a typo can be corrected in place', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'II', 38) }])

      const entered = getEditableMatches(db, ACCOUNT, ME, SOLO).find((m) => m.matchId === 'NA1_A')
      expect(entered?.manual).toEqual(rank('GOLD', 'II', 38))
    })

    it('reports the reading a game started from', () => {
      seedAmbiguousRun(db)
      const oldest = getEditableMatches(db, ACCOUNT, ME, SOLO).find((m) => m.matchId === 'NA1_A')!

      expect(oldest.before).toEqual(rank('GOLD', 'II', 20))
      expect(oldest.beforeUsable).toBe(true)
    })

    it('gives every game of one ambiguous stretch the same beforeAt', () => {
      seedAmbiguousRun(db)
      const stretch = getEditableMatches(db, ACCOUNT, ME, SOLO)

      // The editor keys its chained preview off this: same beforeAt means no
      // real reading separates the games, so each starts where the last ended.
      expect(new Set(stretch.map((m) => m.beforeAt)).size).toBe(1)
      expect(stretch[0].beforeAt).toBe(T0)
    })

    it('flags a game with nothing usable before it', () => {
      insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))
      const first = getEditableMatches(db, ACCOUNT, ME, SOLO)[0]

      expect(first.before).toBeNull()
      expect(first.beforeUsable).toBe(false)
    })
  })

  describe('saveManualRanks', () => {
    it('gives the edited game its LP', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'II', 38) }])

      expect(lpFor(db, 'NA1_A')).toBe(18)
    })

    it('resolves the rest of the run from the entries either side of it', () => {
      seedAmbiguousRun(db)

      // Two entries split a three-game interval into three single-game ones, so
      // the third game gets its LP without ever being touched.
      saveManualRanks(db, ACCOUNT, ME, SOLO, [
        { matchId: 'NA1_A', after: rank('GOLD', 'II', 38) },
        { matchId: 'NA1_B', after: rank('GOLD', 'II', 55) }
      ])

      expect(lpFor(db, 'NA1_A')).toBe(18)
      expect(lpFor(db, 'NA1_B')).toBe(17)
      expect(lpFor(db, 'NA1_C')).toBe(16)

      // The untouched game leaves the list entirely; the two that were entered
      // stay, so they can be corrected.
      expect(getEditableMatches(db, ACCOUNT, ME, SOLO).map((m) => m.matchId)).toEqual([
        'NA1_B',
        'NA1_A'
      ])
    })

    it('writes the reading at the end of the game, not its start', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'II', 38) }])

      const manual = getRankSnapshots(db, ACCOUNT, SOLO).filter((s) => s.source === 'manual')
      expect(manual).toHaveLength(1)
      expect(manual[0].capturedAt).toBe(manualSnapshotTime(T0 + 10 * MINUTE, DURATION))
    })

    it('re-editing corrects the entry rather than stacking another', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'II', 38) }])
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'II', 44) }])

      expect(getRankSnapshots(db, ACCOUNT, SOLO).filter((s) => s.source === 'manual')).toHaveLength(
        1
      )
      expect(lpFor(db, 'NA1_A')).toBe(24)
    })

    it('records a game that moved no LP, so the next one keeps its figure', () => {
      // A loss at 0 LP under demotion protection reads identically to the
      // snapshot before it. The dedupe would drop that row, leaving the
      // interval open and costing the following game its LP too.
      observe(db, rank('SILVER', 'IV', 0), T0)
      insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))
      insertMatch(db, match('NA1_B', T0 + 60 * MINUTE))
      observe(db, rank('SILVER', 'IV', 19), T0 + 120 * MINUTE)

      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('SILVER', 'IV', 0) }])

      expect(lpFor(db, 'NA1_A')).toBe(0)
      expect(lpFor(db, 'NA1_B')).toBe(19)
    })

    it('measures across a division boundary in ladder positions, not raw LP', () => {
      observe(db, rank('GOLD', 'II', 88), T0)
      insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))
      insertMatch(db, match('NA1_B', T0 + 60 * MINUTE))
      observe(db, rank('GOLD', 'I', 40), T0 + 120 * MINUTE)

      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'I', 10) }])

      // 88 LP in Gold II to 10 LP in Gold I is a 22 LP gain, not a 78 LP loss.
      expect(lpFor(db, 'NA1_A')).toBe(22)
      const promoted = getMatchSummaries(db, ME, 50, 0).find((m) => m.matchId === 'NA1_A')
      expect(promoted?.rank?.isPromotion).toBe(true)
    })

    it('measures across a tier boundary', () => {
      observe(db, rank('SILVER', 'I', 92), T0)
      insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))
      insertMatch(db, match('NA1_B', T0 + 60 * MINUTE))
      observe(db, rank('GOLD', 'IV', 40), T0 + 120 * MINUTE)

      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'IV', 14) }])

      expect(lpFor(db, 'NA1_A')).toBe(22)
    })

    it('anchors a game with no earlier reading using the before state', () => {
      insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))

      saveManualRanks(db, ACCOUNT, ME, SOLO, [
        { matchId: 'NA1_A', after: rank('GOLD', 'IV', 35), before: rank('GOLD', 'IV', 17) }
      ])

      expect(lpFor(db, 'NA1_A')).toBe(18)
    })

    it('needs a before on only the first game of a run with no readings at all', () => {
      // History recorded before rank tracking existed has no snapshots to
      // anchor against, so the editor has to collect a starting point. It only
      // needs one: each game after the first starts where the one above it
      // finished, which is exactly what its entry writes.
      insertMatch(db, match('NA1_A', T0 + 10 * MINUTE))
      insertMatch(db, match('NA1_B', T0 + 60 * MINUTE))
      insertMatch(db, match('NA1_C', T0 + 120 * MINUTE))

      saveManualRanks(db, ACCOUNT, ME, SOLO, [
        { matchId: 'NA1_A', after: rank('GOLD', 'IV', 35), before: rank('GOLD', 'IV', 17) },
        { matchId: 'NA1_B', after: rank('GOLD', 'IV', 53) },
        { matchId: 'NA1_C', after: rank('GOLD', 'IV', 36) }
      ])

      expect(lpFor(db, 'NA1_A')).toBe(18)
      expect(lpFor(db, 'NA1_B')).toBe(18)
      expect(lpFor(db, 'NA1_C')).toBe(-17)
    })

    it('refuses a game that is not awaiting an LP figure', () => {
      insertMatch(db, match('NA1_ARAM', T0 + 10 * MINUTE, { queueId: 450 }))

      expect(() =>
        saveManualRanks(db, ACCOUNT, ME, SOLO, [
          { matchId: 'NA1_ARAM', after: rank('GOLD', 'II', 38) }
        ])
      ).toThrow(/not a ranked game/)
    })

    it('writes nothing when one entry in a batch is invalid', () => {
      seedAmbiguousRun(db)

      expect(() =>
        saveManualRanks(db, ACCOUNT, ME, SOLO, [
          { matchId: 'NA1_A', after: rank('GOLD', 'II', 38) },
          { matchId: 'NA1_B', after: rank('GOLD', 'II', 400) }
        ])
      ).toThrow()

      expect(getRankSnapshots(db, ACCOUNT, SOLO).filter((s) => s.source === 'manual')).toEqual([])
    })
  })

  describe('clearManualRank', () => {
    it('removes the derived LP as well as the entry', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'II', 38) }])
      expect(lpFor(db, 'NA1_A')).toBe(18)

      expect(clearManualRank(db, ACCOUNT, ME, 'NA1_A')).toBe(true)

      // The interval is ambiguous again, so a stale hand-entered figure must not
      // survive as though it had been measured.
      expect(lpFor(db, 'NA1_A')).toBeUndefined()
      expect(getRankSnapshots(db, ACCOUNT, SOLO).filter((s) => s.source === 'manual')).toEqual([])
    })

    it('takes the games that resolved on the back of it down too', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [
        { matchId: 'NA1_A', after: rank('GOLD', 'II', 38) },
        { matchId: 'NA1_B', after: rank('GOLD', 'II', 55) }
      ])
      expect(lpFor(db, 'NA1_C')).toBe(16)

      clearManualRank(db, ACCOUNT, ME, 'NA1_B')

      expect(lpFor(db, 'NA1_A')).toBe(18)
      expect(lpFor(db, 'NA1_B')).toBeUndefined()
      expect(lpFor(db, 'NA1_C')).toBeUndefined()
    })

    it('reports when there was no entry to remove', () => {
      seedAmbiguousRun(db)
      expect(clearManualRank(db, ACCOUNT, ME, 'NA1_A')).toBe(false)
    })
  })

  describe('deleteSupersededManualSnapshots', () => {
    it('drops an entry a later reading has measured for the user', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_C', after: rank('GOLD', 'II', 71) }])

      // A reading taken after the last game, with nothing played in between.
      const removed = deleteSupersededManualSnapshots(
        db,
        ACCOUNT,
        ME,
        SOLO,
        420,
        T0 + 200 * MINUTE
      )

      expect(removed).toBe(1)
    })

    it('leaves an entry alone when a game was played after it', () => {
      seedAmbiguousRun(db)
      saveManualRanks(db, ACCOUNT, ME, SOLO, [{ matchId: 'NA1_A', after: rank('GOLD', 'II', 38) }])

      // Games B and C sit between that entry and this reading, so the two
      // describe different moments and both stand.
      const removed = deleteSupersededManualSnapshots(
        db,
        ACCOUNT,
        ME,
        SOLO,
        420,
        T0 + 200 * MINUTE
      )

      expect(removed).toBe(0)
      expect(lpFor(db, 'NA1_A')).toBe(18)
    })
  })

  describe('validateManualRank', () => {
    it('accepts a division rank in range', () => {
      expect(validateManualRank(rank('GOLD', 'II', 63))).toBeNull()
    })

    it('rejects LP past the end of a division', () => {
      expect(validateManualRank(rank('GOLD', 'II', 140))).toMatch(/0 and 99/)
    })

    it('allows LP past 100 above Diamond, where there are no divisions', () => {
      expect(validateManualRank(rank('MASTER', null, 412))).toBeNull()
    })

    it('requires a division below Master', () => {
      expect(validateManualRank(rank('GOLD', null, 20))).toMatch(/division/)
    })

    it('rejects a tier that does not exist', () => {
      expect(validateManualRank(rank('WOOD', 'IV', 0))).toMatch(/tier/)
    })
  })
})
