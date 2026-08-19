import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getHistorySpan,
  getLatestSnapshot,
  getRankMilestones,
  getRankSnapshots,
  getRankedMatchesBetween,
  insertRankSnapshot,
  upsertMatchRank
} from './rankHistory.repo'
import { getMatchSummaries, insertMatch } from './matches.repo'
import { getAccountByRiotId } from './accounts.repo'
import { applyAllMigrations } from '../testMigrations'
import type { MatchDto } from '../../riot/types'
import type { Season } from '@shared/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const ME = 'puuid-me'
const SOLO = 'RANKED_SOLO_5x5' as const
const T0 = 1_700_000_000_000

// Two hand-entered boundaries as local instants. Only the second resets, so a
// pair spanning the first must still report its promotion.
const PRESEASON_2027 = new Date(2026, 11, 22).getTime()
const SEASON_2027 = new Date(2027, 0, 8).getTime()

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
    startsAt: PRESEASON_2027,
    isPreseason: true,
    resetsRank: false
  },
  { id: 3, label: 'Season 2027', startsAt: SEASON_2027, isPreseason: false, resetsRank: true }
]

function gold(division: string, lp: number) {
  return { queueType: SOLO, tier: 'GOLD', rank: division, leaguePoints: lp, wins: 10, losses: 8 }
}

function seedAccount(db: DatabaseSyncType): number {
  db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(
    ME,
    'Alluna',
    'NA1'
  )
  return 1
}

function soloMatch(matchId: string, gameCreation: number, queueId = 420): MatchDto {
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

describe('getAccountByRiotId', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    seedAccount(db)
  })

  it('finds the account the League client reports', () => {
    // The client sends gameName/tagLine; its puuid is a canonical UUID that
    // never equals the encrypted one Riot's public API stored here.
    expect(getAccountByRiotId(db, 'Alluna', 'NA1')?.id).toBe(1)
  })

  it('ignores case, which Riot IDs preserve but do not key on', () => {
    expect(getAccountByRiotId(db, 'alluna', 'na1')?.id).toBe(1)
    expect(getAccountByRiotId(db, 'ALLUNA', 'Na1')?.id).toBe(1)
  })

  it('returns null for an untracked Riot ID', () => {
    expect(getAccountByRiotId(db, 'Alluna', 'EUW')).toBeNull()
    expect(getAccountByRiotId(db, 'SomeoneElse', 'NA1')).toBeNull()
  })
})

describe('rank snapshots', () => {
  let db: DatabaseSyncType
  let accountId: number

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    accountId = seedAccount(db)
  })

  it('stamps the ladder position on write', () => {
    insertRankSnapshot(db, accountId, gold('II', 45), 'league_v4', T0)
    // GOLD is tier index 3, division II is index 2: 3*400 + 2*100 + 45.
    expect(getLatestSnapshot(db, accountId, SOLO)?.ladderPosition).toBe(1445)
  })

  it('appends rather than overwriting', () => {
    insertRankSnapshot(db, accountId, gold('II', 45), 'league_v4', T0)
    insertRankSnapshot(db, accountId, gold('II', 68), 'lcu', T0 + 1000)

    const all = getRankSnapshots(db, accountId, SOLO)
    expect(all.map((s) => s.leaguePoints)).toEqual([45, 68])
    expect(all.map((s) => s.source)).toEqual(['league_v4', 'lcu'])
  })

  it('skips a reading identical to the previous one', () => {
    expect(insertRankSnapshot(db, accountId, gold('II', 45), 'league_v4', T0)).not.toBeNull()
    // The backstop fires on every sync whether or not anything moved.
    expect(insertRankSnapshot(db, accountId, gold('II', 45), 'league_v4', T0 + 5000)).toBeNull()
    expect(getRankSnapshots(db, accountId, SOLO)).toHaveLength(1)
  })

  it('writes an identical reading anyway when forced', () => {
    // A ranked loss at 0 LP with demotion protection reads exactly like the
    // snapshot before it. Deduped away, the interval never closes and goes on
    // to swallow the next game, costing both of them their LP figure.
    insertRankSnapshot(db, accountId, gold('II', 45), 'lcu', T0)
    expect(insertRankSnapshot(db, accountId, gold('II', 45), 'lcu', T0 + 5000, true)).not.toBeNull()

    const all = getRankSnapshots(db, accountId, SOLO)
    expect(all).toHaveLength(2)
    expect(all.map((s) => s.capturedAt)).toEqual([T0, T0 + 5000])
  })

  it('still dedupes the backstop when force is not set', () => {
    insertRankSnapshot(db, accountId, gold('II', 45), 'lcu', T0, true)
    expect(insertRankSnapshot(db, accountId, gold('II', 45), 'league_v4', T0 + 5000)).toBeNull()
    expect(getRankSnapshots(db, accountId, SOLO)).toHaveLength(1)
  })

  it('keeps ladders separate', () => {
    insertRankSnapshot(db, accountId, gold('II', 45), 'league_v4', T0)
    insertRankSnapshot(
      db,
      accountId,
      { ...gold('IV', 12), queueType: 'RANKED_FLEX_SR' },
      'league_v4',
      T0
    )

    expect(getRankSnapshots(db, accountId, SOLO)).toHaveLength(1)
    expect(getLatestSnapshot(db, accountId, 'RANKED_FLEX_SR')?.rank).toBe('IV')
  })

  it('honours a time window', () => {
    insertRankSnapshot(db, accountId, gold('III', 10), 'league_v4', T0)
    insertRankSnapshot(db, accountId, gold('II', 20), 'league_v4', T0 + 10_000)

    expect(getRankSnapshots(db, accountId, SOLO, T0 + 5000)).toHaveLength(1)
    expect(getRankSnapshots(db, accountId, SOLO, null)).toHaveLength(2)
  })
})

describe('getRankMilestones', () => {
  let db: DatabaseSyncType
  let accountId: number

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    accountId = seedAccount(db)
  })

  it('reports crossings and ignores LP movement inside a division', () => {
    insertRankSnapshot(db, accountId, gold('III', 20), 'lcu', T0)
    insertRankSnapshot(db, accountId, gold('III', 95), 'lcu', T0 + 1000) // no crossing
    insertRankSnapshot(db, accountId, gold('II', 12), 'lcu', T0 + 2000) // promotion
    insertRankSnapshot(db, accountId, gold('III', 75), 'lcu', T0 + 3000) // demotion

    const milestones = getRankMilestones(db, accountId, SOLO)
    // Newest first, so the demotion leads.
    expect(milestones.map((m) => m.movement)).toEqual(['demotion', 'promotion'])
    expect(milestones[0].rank).toBe('III')
    expect(milestones[1].rank).toBe('II')
  })

  it('reports nothing from a single snapshot', () => {
    insertRankSnapshot(db, accountId, gold('III', 20), 'lcu', T0)
    expect(getRankMilestones(db, accountId, SOLO)).toEqual([])
  })

  // Local time, matching how a hand-entered boundary is stored.
  const DEC = new Date(2026, 11, 28, 20).getTime()
  const JAN = new Date(2027, 0, 8, 14).getTime()

  it('does not report a ladder reset as a demotion', () => {
    insertRankSnapshot(
      db,
      accountId,
      { queueType: SOLO, tier: 'EMERALD', rank: 'II', leaguePoints: 20, wins: 90, losses: 70 },
      'lcu',
      DEC
    )
    insertRankSnapshot(
      db,
      accountId,
      { queueType: SOLO, tier: 'BRONZE', rank: 'IV', leaguePoints: 0, wins: 0, losses: 0 },
      'lcu',
      JAN
    )

    // Unguarded this is a five-tier fall and the all-time view would announce
    // "Demoted to Bronze IV" every January for the rest of the account's life.
    expect(getRankMilestones(db, accountId, SOLO, null, null, SEASONS)).toEqual([])
  })

  it('still reports a real demotion inside one season', () => {
    insertRankSnapshot(db, accountId, gold('II', 8), 'lcu', DEC)
    insertRankSnapshot(db, accountId, gold('III', 88), 'lcu', DEC + 1000)

    expect(
      getRankMilestones(db, accountId, SOLO, null, null, SEASONS).map((m) => m.movement)
    ).toEqual(['demotion'])
  })

  it('still reports a promotion across a boundary that carried rank forward', () => {
    // Into the preseason. A real period boundary, but nothing was reset, so the
    // promotion over it is a promotion the player earned.
    insertRankSnapshot(db, accountId, gold('III', 90), 'lcu', PRESEASON_2027 - 1000)
    insertRankSnapshot(db, accountId, gold('II', 8), 'lcu', PRESEASON_2027 + 1000)

    expect(
      getRankMilestones(db, accountId, SOLO, null, null, SEASONS).map((m) => m.movement)
    ).toEqual(['promotion'])
  })

  it('bounds a period above as well as below', () => {
    insertRankSnapshot(db, accountId, gold('III', 20), 'lcu', DEC)
    insertRankSnapshot(db, accountId, gold('II', 12), 'lcu', DEC + 1000)
    insertRankSnapshot(db, accountId, gold('I', 12), 'lcu', JAN + 1000)
    insertRankSnapshot(db, accountId, gold('I', 90), 'lcu', JAN + 2000)

    // Everything up to the 2027 season: the two December readings, not the two
    // January ones on the far side of the reset.
    const y2026 = { startMs: null, endMs: SEASON_2027 }
    expect(getRankSnapshots(db, accountId, SOLO, y2026.startMs, y2026.endMs)).toHaveLength(2)
    // The promotion into Gold I happened in 2027 and must not leak backwards.
    expect(
      getRankMilestones(db, accountId, SOLO, y2026.startMs, y2026.endMs, SEASONS).map((m) => m.rank)
    ).toEqual(['II'])
  })
})

describe('getRankedMatchesBetween', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    seedAccount(db)
  })

  it('bounds exclusively below and inclusively above', () => {
    insertMatch(db, soloMatch('NA1_1', T0))
    insertMatch(db, soloMatch('NA1_2', T0 + 1000))

    // T0 itself is excluded — it belongs to the preceding interval.
    expect(getRankedMatchesBetween(db, ME, 420, T0, T0 + 1000).map((m) => m.matchId)).toEqual([
      'NA1_2'
    ])
    expect(getRankedMatchesBetween(db, ME, 420, T0 - 1, T0 + 1000)).toHaveLength(2)
  })

  it('ignores other queues', () => {
    insertMatch(db, soloMatch('NA1_aram', T0 + 500, 450))
    expect(getRankedMatchesBetween(db, ME, 420, T0, T0 + 1000)).toEqual([])
  })
})

describe('upsertMatchRank', () => {
  let db: DatabaseSyncType
  let accountId: number

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    accountId = seedAccount(db)
    insertMatch(db, soloMatch('NA1_1', T0))
  })

  it('surfaces on the match summary once written', () => {
    upsertMatchRank(db, {
      matchId: 'NA1_1',
      accountId,
      queueType: SOLO,
      tierBefore: 'GOLD',
      rankBefore: 'III',
      lpBefore: 95,
      tierAfter: 'GOLD',
      rankAfter: 'II',
      lpAfter: 12,
      lpDelta: 17,
      isPromotion: true,
      isDemotion: false
    })

    const [row] = getMatchSummaries(db, ME, 20, 0)
    expect(row.rank).toEqual({
      lpDelta: 17,
      tierBefore: 'GOLD',
      rankBefore: 'III',
      tierAfter: 'GOLD',
      rankAfter: 'II',
      isPromotion: true,
      isDemotion: false
    })
  })

  it('corrects an existing row instead of failing on the primary key', () => {
    const base = {
      matchId: 'NA1_1',
      accountId,
      queueType: SOLO,
      tierBefore: 'GOLD',
      rankBefore: 'II',
      lpBefore: 20,
      tierAfter: 'GOLD',
      rankAfter: 'II',
      lpAfter: 41,
      isPromotion: false,
      isDemotion: false
    }

    upsertMatchRank(db, { ...base, lpDelta: 21 })
    upsertMatchRank(db, { ...base, lpDelta: 23 })

    expect(getMatchSummaries(db, ME, 20, 0)[0].rank?.lpDelta).toBe(23)
  })
})

describe('getHistorySpan', () => {
  let db: DatabaseSyncType
  let accountId: number

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    accountId = seedAccount(db)
  })

  it('returns null when the account has nothing at all', () => {
    expect(getHistorySpan(db, accountId, ME)).toBeNull()
  })

  it('spans snapshots and matches together', () => {
    // The oldest evidence is a match and the newest is a snapshot, so a span
    // taken from either table alone would be short at one end.
    insertMatch(db, soloMatch('NA1_1', T0))
    insertRankSnapshot(db, accountId, gold('III', 20), 'lcu', T0 + 10_000)

    expect(getHistorySpan(db, accountId, ME)).toEqual({
      oldestMs: T0,
      newestMs: T0 + 10_000
    })
  })

  it('works from snapshots alone, before any match has synced', () => {
    insertRankSnapshot(db, accountId, gold('III', 20), 'lcu', T0)
    expect(getHistorySpan(db, accountId, ME)).toEqual({ oldestMs: T0, newestMs: T0 })
  })
})
