import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { replayAttribution } from './rankAttribution'
import { getEditableTftMatches, saveManualRanks } from './manualRankService'
import { getMatchSummaries } from '../db/repositories/matches.repo'
import { getLeagueEntries, upsertLeagueEntries } from '../db/repositories/accounts.repo'
import { insertRankSnapshot } from '../db/repositories/rankHistory.repo'
import {
  getTftFinishes,
  getTftLobby,
  getTftMatchSummaries,
  insertTftMatch,
  rekeyTftBoards
} from '../db/repositories/tftMatches.repo'
import { applyAllMigrations } from '../db/testMigrations'
import type { TftMatchDto } from '../riot/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

/*
 * TFT on this PC: games stored with all eight boards, LP placed at the
 * player's own elimination, Hyper Roll's rating, and the editor — over a real
 * schema in memory, with nothing of Electron's.
 */

const ME = 'puuid-me'
const ACCOUNT = 1
const T0 = 1_790_000_000_000
const min = (minutes: number): number => T0 + minutes * 60_000

/**
 * A TFT game created at `createdAt`, the lobby lasting 35 minutes, `ME`
 * finishing `placement` and knocked out `eliminatedMin` minutes in.
 */
function tftGame(
  matchId: string,
  createdAt: number,
  placement: number,
  eliminatedMin: number,
  queueId = 1100
): { match: TftMatchDto; raw: string } {
  const others = [1, 2, 3, 4, 5, 6, 7, 8].filter((p) => p !== placement)
  const board = (puuid: string, place: number, partner: number | undefined, eliminated: number) => ({
    puuid,
    riotIdGameName: puuid === ME ? 'Faker' : `Player${place}`,
    riotIdTagline: 'NA1',
    placement: place,
    level: 8,
    last_round: 30,
    time_eliminated: eliminated,
    players_eliminated: 0,
    total_damage_to_players: 50,
    gold_left: 3,
    partner_group_id: partner,
    traits: [{ name: 'TFT18_FloraFatalis', num_units: 4, style: 2, tier_current: 2, tier_total: 4 }],
    units: [{ character_id: 'TFT18_Jinx', tier: 2, rarity: 4, itemNames: ['TFT_Item_InfinityEdge'] }]
  })
  const doubleUp = queueId === 1160
  const participants = [
    board(ME, placement, doubleUp ? Math.ceil(placement / 2) : undefined, eliminatedMin * 60 + 0.4),
    ...others.map((p) => board(`puuid-${p}`, p, doubleUp ? Math.ceil(p / 2) : undefined, (36 - p) * 60))
  ]
  const raw = {
    metadata: { match_id: matchId, participants: participants.map((p) => p.puuid) },
    info: {
      gameCreation: createdAt,
      game_datetime: createdAt + 35 * 60_000,
      game_length: 35 * 60,
      queueId,
      tft_set_number: 18,
      tft_set_core_name: 'TFTSet18',
      participants
    }
  }
  return { match: raw as unknown as TftMatchDto, raw: JSON.stringify(raw) }
}

function store(db: DatabaseSyncType, game: { match: TftMatchDto; raw: string }): void {
  insertTftMatch(db, game.match, game.raw)
}

const ranked = (tier: string, rank: string, lp: number) => ({
  queueType: 'RANKED_TFT' as const,
  tier,
  rank,
  leaguePoints: lp,
  wins: null,
  losses: null
})

describe('TFT on this PC', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(ME, 'Faker', 'NA1')
  })

  it('stores a game with every board, invisible to League’s history', () => {
    store(db, tftGame('NA1_1', min(0), 3, 30))

    expect(db.prepare("SELECT game, queue_id, game_duration FROM matches WHERE match_id = 'NA1_1'").get()).toEqual({
      game: 'tft',
      queue_id: 1100,
      game_duration: 2100
    })
    expect(getTftLobby(db, 'NA1_1', new Map([[ME, ACCOUNT]]))?.participants.map((p) => p.placement)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8
    ])
    expect(getTftLobby(db, 'NA1_1', new Map([[ME, ACCOUNT]]))?.participants[2]).toMatchObject({
      accountId: '1',
      traits: [{ name: 'TFT18_FloraFatalis', numUnits: 4, style: 2 }],
      units: [{ characterId: 'TFT18_Jinx', items: ['TFT_Item_InfinityEdge'] }]
    })
    expect(getMatchSummaries(db, ME, 20, 0)).toEqual([])
  })

  it('stores a game once, however many tracked players were in it', () => {
    store(db, tftGame('NA1_1', min(0), 3, 30))
    store(db, tftGame('NA1_1', min(0), 3, 30))

    expect(getTftMatchSummaries(db, ACCOUNT, ME, 20, 0)).toHaveLength(1)
  })

  it('works out Double Up’s team places from the whole lobby', () => {
    store(db, tftGame('NA1_2', min(0), 3, 30, 1160))

    const [row] = getTftMatchSummaries(db, ACCOUNT, ME, 20, 0)
    expect(row).toMatchObject({ placement: 3, teamPlacement: 2 })
    expect(getTftFinishes(db, ME, null, null)).toEqual([{ placement: 3, teamPlacement: 2, queueId: 1160 }])
  })

  it('places a game at the player’s elimination, so a reading after it closes it', () => {
    // Knocked out at 15 minutes of a 35-minute lobby. A reading at 20 minutes
    // already shows the LP; placed at the lobby's end, the game would fall
    // after that reading and be handed to the next interval.
    store(db, tftGame('NA1_3', min(0), 7, 15))
    insertRankSnapshot(db, ACCOUNT, ranked('GOLD', 'II', 60), 'lcu', min(-5))
    insertRankSnapshot(db, ACCOUNT, ranked('GOLD', 'II', 29), 'lcu', min(20))

    expect(replayAttribution(db, ACCOUNT, ME, null, 'tft')).toBe(1)
    expect(getTftMatchSummaries(db, ACCOUNT, ME, 20, 0)[0].rank).toMatchObject({ lpDelta: -31 })
  })

  it('reads Hyper Roll’s movement in rating, and its colours either side', () => {
    store(db, tftGame('NA1_4', min(0), 1, 25, 1130))
    const reading = (rating: number, colour: string) => ({
      queueType: 'RANKED_TFT_TURBO' as const,
      tier: null,
      rank: null,
      leaguePoints: null,
      wins: null,
      losses: null,
      ratedTier: colour,
      ratedRating: rating
    })
    insertRankSnapshot(db, ACCOUNT, reading(2_560, 'GREEN'), 'lcu', min(-5))
    insertRankSnapshot(db, ACCOUNT, reading(2_720, 'BLUE'), 'lcu', min(30))

    replayAttribution(db, ACCOUNT, ME, null, 'tft')

    expect(getTftMatchSummaries(db, ACCOUNT, ME, 20, 0)[0].rank).toMatchObject({
      lpDelta: 160,
      isPromotion: true,
      ratedTierBefore: 'GREEN',
      ratedTierAfter: 'BLUE'
    })
  })

  it('offers a game the readings could not split to the editor, and takes the rank typed for it', () => {
    // Two games between two readings: neither can be told apart.
    store(db, tftGame('NA1_5', min(0), 2, 30))
    store(db, tftGame('NA1_6', min(40), 6, 30))
    insertRankSnapshot(db, ACCOUNT, ranked('GOLD', 'II', 50), 'lcu', min(-5))
    insertRankSnapshot(db, ACCOUNT, ranked('GOLD', 'II', 63), 'lcu', min(80))
    replayAttribution(db, ACCOUNT, ME, null, 'tft')

    const editable = getEditableTftMatches(db, ACCOUNT, ME, 'RANKED_TFT')
    expect(editable.map((m) => [m.matchId, m.placement])).toEqual([
      ['NA1_6', 6],
      ['NA1_5', 2]
    ])

    // Stating where the first game finished splits the run: both resolve.
    saveManualRanks(db, ACCOUNT, ME, 'RANKED_TFT', [
      { matchId: 'NA1_5', after: { tier: 'GOLD', rank: 'II', leaguePoints: 85 } }
    ])

    const deltas = getTftMatchSummaries(db, ACCOUNT, ME, 20, 0).map((m) => [m.matchId, m.rank?.lpDelta ?? null])
    expect(deltas).toEqual([
      ['NA1_6', -22],
      ['NA1_5', 35]
    ])
  })

  it('refuses LP for Hyper Roll, which has none', () => {
    expect(() =>
      saveManualRanks(db, ACCOUNT, ME, 'RANKED_TFT_TURBO', [
        { matchId: 'NA1_7', after: { tier: 'GOLD', rank: 'II', leaguePoints: 10 } }
      ])
    ).toThrow('Hyper Roll has a rating, not LP')
  })

  it('keeps each game’s ladders apart', () => {
    upsertLeagueEntries(db, ACCOUNT, [
      { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I', leaguePoints: 10 },
      { queueType: 'RANKED_TFT', tier: 'SILVER', rank: 'II', leaguePoints: 40 },
      { queueType: 'RANKED_TFT_TURBO', ratedTier: 'BLUE', ratedRating: 2_904 }
    ])
    upsertLeagueEntries(
      db,
      ACCOUNT,
      [
        { queueType: 'RANKED_TFT', tier: 'SILVER', rank: 'II', leaguePoints: 40 },
        { queueType: 'RANKED_TFT_TURBO', ratedTier: 'BLUE', ratedRating: 2_904 }
      ],
      'tft'
    )

    expect(getLeagueEntries(db, ACCOUNT).map((e) => e.queueType)).toEqual(['RANKED_SOLO_5x5'])
    expect(getLeagueEntries(db, ACCOUNT, 'tft')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ queueType: 'RANKED_TFT', tier: 'SILVER' }),
        expect.objectContaining({ queueType: 'RANKED_TFT_TURBO', ratedTier: 'BLUE', ratedRating: 2_904 })
      ])
    )
  })

  it('moves a player’s boards, and the ids inside their payloads, when their TFT id changes', () => {
    store(db, tftGame('NA1_8', min(0), 4, 30))

    expect(rekeyTftBoards(db, ME, 'puuid-tft-key')).toBe(1)
    expect(getTftMatchSummaries(db, ACCOUNT, 'puuid-tft-key', 20, 0)).toHaveLength(1)
    const raw = db.prepare("SELECT raw_json FROM matches WHERE match_id = 'NA1_8'").get() as { raw_json: string }
    expect(raw.raw_json).toContain('puuid-tft-key')
    expect(raw.raw_json).not.toContain(`"${ME}"`)
  })
})
