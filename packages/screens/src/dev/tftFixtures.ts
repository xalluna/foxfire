import type {
  Account,
  LeagueEntry,
  ManualRankEdit,
  MatchRankInfo,
  RankSnapshot,
  Season,
  TftDashboard,
  TftEditableMatch,
  TftLadder,
  TftLadderSummary,
  TftLobby,
  TftLobbyParticipant,
  TftMatchSummary,
  TftTrait,
  TftUnit
} from '@foxfire/core'
import {
  LADDERS,
  countedPlacement,
  ladderPosition,
  laddersOf,
  rankAtPosition,
  ratedTierAt,
  seasonAt,
  seasonBoundsOf,
  teamPlacements,
  tftGameEndMs
} from '@foxfire/core'
import { DAY, HOUR, NOW } from './catalog'

/*
 * TFT, as the harness plays it: a set's worth of games on the home account
 * across all four queues, with every board filled in, two climbs and a rated
 * ladder — enough for every TFT surface to be designed against something that
 * looks like a season.
 *
 * Generated from a fixed seed, so the harness looks the same on every load and
 * a screenshot taken today matches one taken next week.
 */

/** Set 17 and Set 18, the way the server seeds them, dated relative to now so the harness keeps working. */
export const TFT_SEASONS: Season[] = [
  { id: 917, label: 'Set 17', startsAt: NOW - 190 * DAY, isPreseason: false, resetsRank: true, game: 'tft' },
  { id: 918, label: 'Set 18', startsAt: NOW - 58 * DAY, isPreseason: false, resetsRank: true, game: 'tft' }
]

/** A small linear congruential generator — deterministic, and enough for fixtures. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

const TRAITS = [
  'TFT18_FloraFatalis',
  'TFT18_Executioner',
  'TFT18_Thornmaiden',
  'TFT18_Blackthorn',
  'TFT18_Defender',
  'TFT18_Spellweaver',
  'TFT18_Sprykin',
  'TFT18_Summoner'
]

const UNITS: Array<[id: string, rarity: number]> = [
  ['TFT18_Poppy', 0],
  ['TFT18_Zyra', 0],
  ['TFT18_Elise', 1],
  ['TFT18_Vex', 1],
  ['TFT18_Lillia', 2],
  ['TFT18_Ahri', 2],
  ['TFT18_Morgana', 4],
  ['TFT18_Jinx', 4],
  ['TFT18_Karma', 6],
  ['TFT18_Xayah', 6]
]

const ITEMS = [
  'TFT_Item_InfinityEdge',
  'TFT_Item_JeweledGauntlet',
  'TFT_Item_Bloodthirster',
  'TFT_Item_WarmogsArmor',
  'TFT_Item_SpearOfShojin',
  'TFT_Item_GuinsoosRageblade',
  'TFT_Item_ThiefsGloves'
]

const AUGMENTS = ['TFT18_Augment_Pandora', 'TFT18_Augment_ItemGrabBag', 'TFT18_Augment_BuiltDifferent', 'TFT_Augment_HighRoller']

/** Where every TFT queue sits in the harness's history, newest first. */
const QUEUE_ROTATION = [1100, 1100, 1160, 1100, 1130, 1100, 1090, 1100, 1160, 1100]

function board(random: () => number, placement: number): { traits: TftTrait[]; units: TftUnit[]; augments: string[] } {
  // Better boards finish higher, roughly: more stars, more active traits.
  const strength = (9 - placement) / 8
  const units = UNITS.slice()
    .sort(() => random() - 0.5)
    .slice(0, 7 + Math.round(strength * 2))
    .map(([characterId, rarity]) => ({
      characterId,
      tier: random() < strength * 0.6 ? 3 : random() < 0.8 ? 2 : 1,
      rarity,
      items: ITEMS.slice()
        .sort(() => random() - 0.5)
        .slice(0, random() < strength ? 3 : Math.floor(random() * 3))
    }))
    .sort((a, b) => b.rarity - a.rarity || b.tier - a.tier)

  const traits = TRAITS.slice(0, 5 + Math.round(strength * 3)).map((name, i) => {
    const style = i === 0 ? (strength > 0.7 ? 4 : 3) : Math.max(0, Math.min(3, Math.round(random() * 3 * strength + (i < 3 ? 1 : 0))))
    return { name, numUnits: style === 0 ? 1 : style + 1, style, tierCurrent: style, tierTotal: 4 }
  })

  return { traits, units, augments: AUGMENTS.slice(0, 3).sort(() => random() - 0.5) }
}

/** The stage a player reached, as Riot's round count: earlier for a lower place. */
function lastRoundFor(placement: number): number {
  return 38 - placement * 2
}

interface StoredGame {
  matchId: string
  gameCreation: number
  gameDuration: number
  queueId: number
  lobby: TftLobbyParticipant[]
}

function generateGames(account: Account, count: number, seed: number): StoredGame[] {
  const random = seeded(seed)
  const games: StoredGame[] = []

  for (let i = 0; i < count; i++) {
    const queueId = QUEUE_ROTATION[i % QUEUE_ROTATION.length]!
    const matchId = `NA1_${7_400_000_000 - i * 1_317}`
    const gameCreation = NOW - 3 * HOUR - i * 9 * HOUR - Math.floor(random() * 3) * HOUR
    const gameDuration = queueId === 1130 ? 1_350 + Math.floor(random() * 200) : 2_050 + Math.floor(random() * 400)
    const mine = 1 + Math.floor(Math.pow(random(), 1.3) * 8)

    const order = [mine, ...[1, 2, 3, 4, 5, 6, 7, 8].filter((p) => p !== mine)]
    const players = order.map((placement, slot) => {
      const own = slot === 0
      const timeEliminated = placement === 1 ? gameDuration : gameDuration - (placement - 1) * 140 - Math.floor(random() * 40)
      return {
        puuid: own ? account.puuid : `fixture-tft-${i}-${slot}`,
        gameName: own ? account.gameName : `Tactician${(i * 7 + slot) % 40}`,
        tagLine: own ? account.tagLine : 'NA1',
        accountId: own ? account.id : null,
        partnerGroupId: queueId === 1160 ? Math.ceil(placement / 2) : null,
        placement,
        teamPlacement: null as number | null,
        level: Math.max(6, 10 - Math.ceil(placement / 2)),
        lastRound: lastRoundFor(placement),
        timeEliminated,
        playersEliminated: Math.max(0, 4 - placement),
        totalDamageToPlayers: 150 - placement * 14 + Math.floor(random() * 20),
        goldLeft: Math.floor(random() * 12),
        ...board(random, placement)
      }
    })

    const teams = teamPlacements(players)
    for (const p of players) p.teamPlacement = teams.get(p.puuid) ?? null

    games.push({
      matchId,
      gameCreation,
      gameDuration,
      queueId,
      lobby: players.sort((a, b) => a.placement - b.placement)
    })
  }

  return games
}

const GAMES = new Map<string, StoredGame[]>()

/** The home account plays a lot of TFT; the climb account a little; everybody else none. */
function gamesFor(account: Account): StoredGame[] {
  const known = GAMES.get(account.id)
  if (known) return known
  const count = account.id === '1' ? 64 : account.id === '2' ? 9 : 0
  const games = generateGames(account, count, 9_181 + Number(account.id))
  GAMES.set(account.id, games)
  return games
}

/** LP for a ranked TFT finish, the way Riot hands it out near the middle of the ladder. */
function lpFor(placement: number): number {
  return [44, 33, 24, 13, -11, -21, -31, -42][placement - 1] ?? 0
}

interface Climb {
  snapshots: RankSnapshot[]
  ranks: Map<string, MatchRankInfo>
}

const CLIMBS = new Map<string, Map<TftLadder, Climb>>()

/** Each ranked ladder's readings and per-game figures, walked oldest first from a start. */
function climbsFor(account: Account): Map<TftLadder, Climb> {
  const known = CLIMBS.get(account.id)
  if (known) return known

  const climbs = new Map<TftLadder, Climb>()
  const games = gamesFor(account).slice().reverse()

  for (const ladder of laddersOf('tft') as TftLadder[]) {
    const queueId = LADDERS[ladder].queueId
    const rated = LADDERS[ladder].scale === 'rated'
    let position = rated ? 2_480 : ladder === 'RANKED_TFT' ? 1_860 : 1_340
    const snapshots: RankSnapshot[] = []
    const ranks = new Map<string, MatchRankInfo>()

    const reading = (at: number): RankSnapshot => {
      const rank = rated ? null : rankAtPosition(position)
      return {
        queueType: ladder,
        tier: rank?.tier ?? null,
        rank: rank?.rank ?? null,
        leaguePoints: rank?.leaguePoints ?? null,
        wins: null,
        losses: null,
        ladderPosition: position,
        seasonId: seasonAt(TFT_SEASONS, at)?.id ?? null,
        source: 'lcu',
        capturedAt: at,
        ...(rated ? { ratedTier: ratedTierAt(position), ratedRating: position } : {})
      }
    }

    const ownGames = games.filter((g) => g.queueId === queueId)
    if (ownGames.length === 0) continue

    snapshots.push(reading(ownGames[0]!.gameCreation - HOUR))

    for (const game of ownGames) {
      const me = game.lobby.find((p) => p.accountId === account.id)!
      const before = snapshots.at(-1)!
      const delta = rated ? lpFor(me.placement) * 4 : lpFor(countedPlacement(me, game.queueId))
      position = Math.max(0, position + delta)
      const after = reading(tftGameEndMs(game.gameCreation, me.timeEliminated, game.gameDuration) + 60_000)
      snapshots.push(after)

      ranks.set(game.matchId, {
        lpDelta: delta,
        tierBefore: before.tier,
        rankBefore: before.rank,
        tierAfter: after.tier,
        rankAfter: after.rank,
        isPromotion: !rated && before.tier !== after.tier && delta > 0,
        isDemotion: !rated && before.tier !== after.tier && delta < 0,
        ...(rated ? { ratedTierBefore: before.ratedTier ?? null, ratedTierAfter: after.ratedTier ?? null } : {})
      })
    }

    climbs.set(ladder, { snapshots, ranks })
  }

  CLIMBS.set(account.id, climbs)
  return climbs
}

/** What the harness's LP editor has had typed into it, by account and game. */
const MANUAL = new Map<string, Map<string, ManualRankEdit>>()

function rowFor(account: Account, game: StoredGame): TftMatchSummary {
  const me = game.lobby.find((p) => p.accountId === account.id)!
  const ladder = (laddersOf('tft') as TftLadder[]).find((l) => LADDERS[l].queueId === game.queueId)
  const manual = MANUAL.get(account.id)?.get(game.matchId)
  // Every fifth ranked game reads as one no reading pinned down, so the
  // editor has something to offer.
  const unattributed = ladder !== undefined && Number(game.matchId.slice(-1)) % 5 === 0 && !manual

  return {
    matchId: game.matchId,
    gameCreation: game.gameCreation,
    gameDuration: game.gameDuration,
    queueId: game.queueId,
    setNumber: 18,
    placement: me.placement,
    teamPlacement: me.teamPlacement,
    level: me.level,
    lastRound: me.lastRound,
    timeEliminated: me.timeEliminated,
    playersEliminated: me.playersEliminated,
    totalDamageToPlayers: me.totalDamageToPlayers,
    goldLeft: me.goldLeft,
    traits: me.traits,
    units: me.units,
    augments: me.augments,
    rank: ladder && !unattributed ? (climbsFor(account).get(ladder)?.ranks.get(game.matchId) ?? null) : null,
    hasManualRank: manual !== undefined,
    recording: null
  }
}

export function tftMatchesFor(account: Account, queueId: number | null): TftMatchSummary[] {
  return gamesFor(account)
    .filter((g) => queueId === null || g.queueId === queueId)
    .map((g) => rowFor(account, g))
}

export function tftLobbyFor(matchId: string, accounts: Account[]): TftLobby | null {
  for (const account of accounts) {
    const game = gamesFor(account).find((g) => g.matchId === matchId)
    if (game) {
      return {
        matchId,
        gameCreation: game.gameCreation,
        gameDuration: game.gameDuration,
        queueId: game.queueId,
        setNumber: 18,
        participants: game.lobby
      }
    }
  }
  return null
}

export function tftSnapshotsFor(account: Account, ladder: TftLadder): RankSnapshot[] {
  return climbsFor(account).get(ladder)?.snapshots ?? []
}

function summaryFor(account: Account, ladder: TftLadder): TftLadderSummary {
  const current = seasonAt(TFT_SEASONS, NOW)
  const bounds = current ? seasonBoundsOf(TFT_SEASONS, current.id) : null
  const slots = LADDERS[ladder].placementSlots
  const counted = gamesFor(account)
    .filter((g) => g.queueId === LADDERS[ladder].queueId)
    .filter((g) => bounds?.startMs == null || g.gameCreation >= bounds.startMs)
    .map((g) => countedPlacement(g.lobby.find((p) => p.accountId === account.id)!, g.queueId))

  const placements = Array.from({ length: slots }, (_, i) => counted.filter((c) => c === i + 1).length)

  return {
    queueType: ladder,
    games: counted.length,
    placements,
    averagePlacement: counted.length === 0 ? null : counted.reduce((a, b) => a + b, 0) / counted.length,
    topRate: counted.length === 0 ? null : counted.filter((c) => c <= slots / 2).length / counted.length
  }
}

export function tftDashboardFor(account: Account, access: TftDashboard['tftAccess']): TftDashboard {
  const ladders = laddersOf('tft') as TftLadder[]

  const leagueEntries: LeagueEntry[] = ladders.flatMap((ladder) => {
    const last = tftSnapshotsFor(account, ladder).at(-1)
    if (!last) return []
    const games = summaryFor(account, ladder)
    return [
      {
        queueType: ladder,
        tier: last.tier,
        rank: last.rank,
        leaguePoints: last.leaguePoints,
        wins: games.placements[0] ?? 0,
        losses: games.games - (games.placements[0] ?? 0),
        fetchedAt: new Date(NOW).toISOString(),
        ratedTier: last.ratedTier ?? null,
        ratedRating: last.ratedRating ?? null
      }
    ]
  })

  return {
    account,
    leagueEntries,
    syncState: {
      accountId: account.id,
      game: 'tft',
      mostRecentMatchId: gamesFor(account)[0]?.matchId ?? null,
      backfillComplete: true,
      backfillTarget: 200,
      lastFullSyncAt: new Date(NOW - DAY).toISOString(),
      lastDeltaSyncAt: new Date(NOW - HOUR).toISOString(),
      cooldownUntil: null
    },
    ladders: ladders.map((ladder) => summaryFor(account, ladder)),
    seasonLabel: seasonAt(TFT_SEASONS, NOW)?.label ?? null,
    tftAccess: access
  }
}

export function tftEditableFor(account: Account, ladder: TftLadder): TftEditableMatch[] {
  const snapshots = tftSnapshotsFor(account, ladder)

  return tftMatchesFor(account, LADDERS[ladder].queueId)
    .filter((row) => row.rank === null || row.hasManualRank)
    .map((row) => {
      const placedAt = tftGameEndMs(row.gameCreation, row.timeEliminated, row.gameDuration)
      const before = snapshots.filter((s) => s.capturedAt < placedAt).at(-1) ?? null
      const manual = MANUAL.get(account.id)?.get(row.matchId)
      return {
        matchId: row.matchId,
        gameCreation: row.gameCreation,
        gameDuration: row.gameDuration,
        queueId: LADDERS[ladder].queueId,
        placement: row.placement,
        teamPlacement: row.teamPlacement,
        before: before?.tier ? { tier: before.tier, rank: before.rank, leaguePoints: before.leaguePoints ?? 0 } : null,
        beforeAt: before?.capturedAt ?? null,
        beforeUsable: before?.ladderPosition != null,
        manual: manual?.after ?? null
      }
    })
}

export function saveTftManual(account: Account, ladder: TftLadder, edits: ManualRankEdit[]): TftEditableMatch[] {
  const typed = MANUAL.get(account.id) ?? new Map<string, ManualRankEdit>()
  for (const edit of edits) typed.set(edit.matchId, edit)
  MANUAL.set(account.id, typed)

  // The figure the row shows, from what was typed — as the server would work it out.
  const climb = climbsFor(account).get(ladder)
  for (const edit of edits) {
    const editable = tftEditableFor(account, ladder).find((g) => g.matchId === edit.matchId)
    const from = editable?.before ? ladderPosition(editable.before) : null
    const to = ladderPosition(edit.after)
    if (climb && from !== null && to !== null) {
      climb.ranks.set(edit.matchId, {
        lpDelta: to - from,
        tierBefore: editable?.before?.tier ?? null,
        rankBefore: editable?.before?.rank ?? null,
        tierAfter: edit.after.tier,
        rankAfter: edit.after.rank,
        isPromotion: false,
        isDemotion: false
      })
    }
  }

  return tftEditableFor(account, ladder)
}

export function clearTftManual(account: Account, ladder: TftLadder, matchId: string): TftEditableMatch[] {
  MANUAL.get(account.id)?.delete(matchId)
  climbsFor(account).get(ladder)?.ranks.delete(matchId)
  return tftEditableFor(account, ladder)
}
