import type {
  Account,
  LeagueEntry,
  LiveGameData,
  MasteryEntry,
  MatchDetail,
  MatchParticipant,
  MatchSummary,
  WinRateEntry
} from '@shared/types'

/**
 * Fixture data for the browser harness (see mockApi.ts).
 *
 * Shaped after a real NA solo-queue history so the UI is designed against
 * plausible numbers rather than round ones. The list deliberately includes the
 * cases that break layouts: a perfect KDA, a support on single-digit CS, an
 * ARAM game with no lane assigned, an unranked flex queue, a name long enough
 * to need truncation, and a participant whose Riot ID never resolved.
 *
 * Dev-only — main.tsx imports this lazily behind import.meta.env.DEV, so it is
 * tree-shaken out of production builds.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Fixed so relative timestamps ("2 hours ago") stay stable within a session. */
const NOW = Date.now()

export const ACCOUNTS: Account[] = [
  {
    id: 1,
    puuid: 'puuid-alluna',
    gameName: 'Alluna',
    tagLine: 'NA1',
    platform: 'na1',
    regionalRoute: 'americas',
    summonerId: 'sum-alluna',
    profileIconId: 6299,
    summonerLevel: 412,
    isHomeAccount: true,
    createdAt: '2026-01-04T10:00:00Z',
    updatedAt: '2026-08-14T18:00:00Z'
  },
  {
    id: 2,
    // Long enough to exercise truncation in the 64px rail and the 320px card.
    puuid: 'puuid-smurf',
    gameName: 'AbsolutelyEnormousName',
    tagLine: 'EUW',
    platform: 'euw1',
    regionalRoute: 'europe',
    summonerId: 'sum-smurf',
    profileIconId: 5789,
    summonerLevel: 37,
    isHomeAccount: false,
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z'
  }
]

export const LEAGUE_ENTRIES: Record<number, LeagueEntry[]> = {
  1: [
    {
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      rank: 'II',
      leaguePoints: 47,
      wins: 62,
      losses: 58,
      fetchedAt: '2026-08-14T18:00:00Z'
    }
    // Flex intentionally absent — the UI must synthesise an unranked card.
  ],
  2: [
    {
      queueType: 'RANKED_SOLO_5x5',
      tier: 'EMERALD',
      rank: 'IV',
      leaguePoints: 12,
      wins: 24,
      losses: 19,
      fetchedAt: '2026-08-13T12:00:00Z'
    },
    {
      queueType: 'RANKED_FLEX_SR',
      tier: 'CHALLENGER',
      rank: 'I',
      leaguePoints: 1204,
      wins: 180,
      losses: 120,
      fetchedAt: '2026-08-13T12:00:00Z'
    }
  ]
}

/** Champion ids referenced below, named for readability. */
const C = {
  Nunu: 20,
  MissFortune: 21,
  DrMundo: 36,
  Malphite: 54,
  Orianna: 61,
  LeeSin: 64,
  Garen: 86,
  Leona: 89,
  Lux: 99,
  Ahri: 103,
  Viktor: 112,
  Syndra: 134,
  Kaisa: 145,
  Jhin: 202,
  Jinx: 222,
  Zed: 238,
  Qiyana: 246,
  Vi: 254,
  Nami: 267,
  Aatrox: 266,
  Thresh: 412,
  Ivern: 427,
  Yone: 777,
  Sett: 875
} as const

/** Summoner spell ids. */
const S = {
  Cleanse: 1, Exhaust: 3, Flash: 4, Ghost: 6, Heal: 7,
  Smite: 11, Teleport: 12, Ignite: 14, Barrier: 21
}

/** Keystone ids paired with a secondary tree id. */
const K = {
  Electrocute: [8112, 8400],
  DarkHarvest: [8128, 8200],
  ArcaneComet: [8229, 8300],
  PhaseRush: [8230, 8100],
  Conqueror: [8010, 8300],
  PressTheAttack: [8005, 8400],
  LethalTempo: [8008, 8300],
  FirstStrike: [8369, 8200],
  Grasp: [8437, 8300],
  Aftershock: [8439, 8000],
  Guardian: [8465, 8300],
  HailOfBlades: [9923, 8200]
} as const

type Keystone = keyof typeof K

/** Matches the `perks` shape match-v5 returns, as far as the UI reads it. */
function perks(keystone: Keystone): unknown {
  const [perk, secondaryStyle] = K[keystone]
  return {
    statPerks: { defense: 5011, flex: 5008, offense: 5005 },
    styles: [
      { description: 'primaryStyle', style: secondaryStyle, selections: [{ perk }] },
      { description: 'subStyle', style: secondaryStyle, selections: [] }
    ]
  }
}

interface MatchSeed {
  champ: number
  k: number
  d: number
  a: number
  cs: number
  win: boolean
  mins: number
  secs: number
  queueId: number
  position: string
  spells: [number, number]
  keystone: Keystone
  items: number[]
  damage: number
  teamKills: number
  teamDamage: number
  gold: number
  multiKill?: number
  agoMs: number
}

const ITEMS_AP = [1056, 3157, 3100, 2503, 3067, 3363, 3009]
const ITEMS_AD = [6672, 3006, 3031, 1038, 6673, 3363, 0]
const ITEMS_TANK = [3068, 3047, 3075, 3143, 1028, 3364, 0]
const ITEMS_SUPPORT = [3853, 3158, 3011, 3222, 0, 3364, 0]

const SEEDS: MatchSeed[] = [
  {
    champ: C.Viktor, k: 2, d: 4, a: 4, cs: 243, win: true, mins: 27, secs: 49,
    queueId: 420, position: 'MIDDLE', spells: [S.Teleport, S.Flash], keystone: 'ArcaneComet',
    items: ITEMS_AP, damage: 18_900, teamKills: 30, teamDamage: 82_000, gold: 13_400, agoMs: 2 * HOUR
  },
  {
    champ: C.Ahri, k: 5, d: 8, a: 5, cs: 214, win: false, mins: 32, secs: 46,
    queueId: 420, position: 'MIDDLE', spells: [S.Flash, S.Ignite], keystone: 'Electrocute',
    items: ITEMS_AP, damage: 24_100, teamKills: 26, teamDamage: 96_000, gold: 14_200, agoMs: 21 * HOUR
  },
  {
    // Perfect KDA — the ratio must render as a word, not Infinity.
    champ: C.Jhin, k: 13, d: 0, a: 17, cs: 171, win: true, mins: 24, secs: 57,
    queueId: 420, position: 'BOTTOM', spells: [S.Flash, S.Heal], keystone: 'LethalTempo',
    items: ITEMS_AD, damage: 31_400, teamKills: 51, teamDamage: 104_000, gold: 15_900,
    multiKill: 2, agoMs: 23 * HOUR
  },
  {
    champ: C.Sett, k: 2, d: 5, a: 4, cs: 159, win: true, mins: 21, secs: 6,
    queueId: 420, position: 'TOP', spells: [S.Teleport, S.Flash], keystone: 'Grasp',
    items: ITEMS_TANK, damage: 12_300, teamKills: 21, teamDamage: 61_000, gold: 9_800, agoMs: DAY
  },
  {
    champ: C.Aatrox, k: 4, d: 5, a: 4, cs: 236, win: false, mins: 32, secs: 44,
    queueId: 420, position: 'TOP', spells: [S.Flash, S.Teleport], keystone: 'Conqueror',
    items: ITEMS_AD, damage: 27_800, teamKills: 18, teamDamage: 88_000, gold: 14_600, agoMs: DAY + 4 * HOUR
  },
  {
    champ: C.Viktor, k: 7, d: 3, a: 12, cs: 180, win: true, mins: 27, secs: 3,
    queueId: 420, position: 'MIDDLE', spells: [S.Flash, S.Barrier], keystone: 'ArcaneComet',
    items: ITEMS_AP, damage: 26_700, teamKills: 36, teamDamage: 91_000, gold: 13_100, agoMs: 2 * DAY
  },
  {
    // Support on single-digit CS — the CS/min column must not look broken.
    champ: C.Nami, k: 2, d: 6, a: 25, cs: 8, win: false, mins: 27, secs: 4,
    queueId: 420, position: 'UTILITY', spells: [S.Flash, S.Exhaust], keystone: 'Guardian',
    items: ITEMS_SUPPORT, damage: 8_200, teamKills: 27, teamDamage: 74_000, gold: 8_900, agoMs: 2 * DAY + 3 * HOUR
  },
  {
    champ: C.Vi, k: 5, d: 5, a: 2, cs: 202, win: false, mins: 26, secs: 31,
    queueId: 420, position: 'JUNGLE', spells: [S.Smite, S.Flash], keystone: 'Electrocute',
    items: ITEMS_AD, damage: 19_400, teamKills: 15, teamDamage: 70_000, gold: 12_200,
    multiKill: 2, agoMs: 2 * DAY + 9 * HOUR
  },
  {
    champ: C.Kaisa, k: 8, d: 6, a: 9, cs: 290, win: false, mins: 39, secs: 27,
    queueId: 420, position: 'BOTTOM', spells: [S.Flash, S.Heal], keystone: 'PressTheAttack',
    items: ITEMS_AD, damage: 38_900, teamKills: 32, teamDamage: 121_000, gold: 19_400,
    multiKill: 2, agoMs: 2 * DAY + 14 * HOUR
  },
  {
    // Pentakill — the badge must survive being the widest one.
    champ: C.Zed, k: 22, d: 2, a: 20, cs: 230, win: true, mins: 33, secs: 30,
    queueId: 420, position: 'MIDDLE', spells: [S.Flash, S.Ignite], keystone: 'Electrocute',
    items: ITEMS_AD, damage: 44_200, teamKills: 42, teamDamage: 118_000, gold: 21_800,
    multiKill: 5, agoMs: 3 * DAY
  },
  {
    champ: C.Zed, k: 8, d: 4, a: 10, cs: 179, win: true, mins: 25, secs: 45,
    queueId: 420, position: 'MIDDLE', spells: [S.Flash, S.Ignite], keystone: 'LethalTempo',
    items: ITEMS_AD, damage: 23_600, teamKills: 36, teamDamage: 86_000, gold: 12_700,
    multiKill: 3, agoMs: 3 * DAY + 6 * HOUR
  },
  {
    champ: C.Viktor, k: 14, d: 4, a: 15, cs: 236, win: true, mins: 32, secs: 21,
    queueId: 420, position: 'MIDDLE', spells: [S.Flash, S.Teleport], keystone: 'PhaseRush',
    items: ITEMS_AP, damage: 33_100, teamKills: 47, teamDamage: 109_000, gold: 16_800,
    multiKill: 3, agoMs: 4 * DAY
  },
  {
    champ: C.Thresh, k: 6, d: 1, a: 12, cs: 21, win: true, mins: 24, secs: 15,
    queueId: 420, position: 'UTILITY', spells: [S.Flash, S.Ignite], keystone: 'Aftershock',
    items: ITEMS_SUPPORT, damage: 11_200, teamKills: 30, teamDamage: 78_000, gold: 9_600, agoMs: 4 * DAY + 5 * HOUR
  },
  {
    champ: C.Garen, k: 1, d: 3, a: 4, cs: 135, win: false, mins: 20, secs: 7,
    queueId: 420, position: 'TOP', spells: [S.Flash, S.Ghost], keystone: 'Conqueror',
    items: ITEMS_TANK, damage: 9_800, teamKills: 12, teamDamage: 48_000, gold: 8_100, agoMs: 4 * DAY + 12 * HOUR
  },
  {
    champ: C.Ahri, k: 6, d: 4, a: 13, cs: 233, win: false, mins: 32, secs: 52,
    queueId: 420, position: 'MIDDLE', spells: [S.Flash, S.Teleport], keystone: 'ArcaneComet',
    items: ITEMS_AP, damage: 29_400, teamKills: 28, teamDamage: 98_000, gold: 15_100,
    multiKill: 2, agoMs: 5 * DAY
  },
  {
    // Short game, exercises the duration column at its narrowest.
    champ: C.Jinx, k: 4, d: 3, a: 5, cs: 115, win: true, mins: 15, secs: 18,
    queueId: 400, position: 'BOTTOM', spells: [S.Flash, S.Heal], keystone: 'FirstStrike',
    items: ITEMS_AD, damage: 14_600, teamKills: 17, teamDamage: 52_000, gold: 8_700, agoMs: 5 * DAY + 4 * HOUR
  },
  {
    champ: C.Malphite, k: 1, d: 1, a: 4, cs: 170, win: false, mins: 26, secs: 2,
    queueId: 440, position: 'TOP', spells: [S.Flash, S.Teleport], keystone: 'Aftershock',
    items: ITEMS_TANK, damage: 13_900, teamKills: 19, teamDamage: 66_000, gold: 10_400, agoMs: 5 * DAY + 11 * HOUR
  },
  {
    champ: C.LeeSin, k: 3, d: 3, a: 10, cs: 271, win: true, mins: 31, secs: 46,
    queueId: 420, position: 'JUNGLE', spells: [S.Smite, S.Flash], keystone: 'Conqueror',
    items: ITEMS_AD, damage: 21_700, teamKills: 32, teamDamage: 84_000, gold: 14_900, agoMs: 5 * DAY + 20 * HOUR
  },
  {
    // ARAM: teamPosition is empty, so no position icon may render.
    champ: C.MissFortune, k: 17, d: 9, a: 38, cs: 156, win: false, mins: 29, secs: 4,
    queueId: 450, position: '', spells: [S.Flash, S.Cleanse], keystone: 'HailOfBlades',
    items: ITEMS_AD, damage: 61_300, teamKills: 67, teamDamage: 189_000, gold: 18_200,
    multiKill: 3, agoMs: 7 * DAY
  },
  {
    champ: C.Ivern, k: 7, d: 6, a: 21, cs: 211, win: true, mins: 36, secs: 43,
    queueId: 420, position: 'JUNGLE', spells: [S.Smite, S.Flash], keystone: 'Guardian',
    items: ITEMS_SUPPORT, damage: 16_400, teamKills: 43, teamDamage: 94_000, gold: 13_800, agoMs: 8 * DAY
  },
  {
    champ: C.DrMundo, k: 9, d: 7, a: 6, cs: 248, win: true, mins: 34, secs: 12,
    queueId: 420, position: 'TOP', spells: [S.Teleport, S.Flash], keystone: 'Grasp',
    items: ITEMS_TANK, damage: 25_300, teamKills: 34, teamDamage: 92_000, gold: 15_600, agoMs: 9 * DAY
  },
  {
    champ: C.Qiyana, k: 11, d: 8, a: 7, cs: 194, win: false, mins: 28, secs: 39,
    queueId: 420, position: 'MIDDLE', spells: [S.Flash, S.Ignite], keystone: 'Electrocute',
    items: ITEMS_AD, damage: 28_800, teamKills: 24, teamDamage: 87_000, gold: 13_900,
    multiKill: 4, agoMs: 10 * DAY
  },
  {
    champ: C.Leona, k: 1, d: 9, a: 19, cs: 14, win: false, mins: 30, secs: 55,
    queueId: 420, position: 'UTILITY', spells: [S.Flash, S.Ignite], keystone: 'Aftershock',
    items: ITEMS_SUPPORT, damage: 7_600, teamKills: 22, teamDamage: 71_000, gold: 9_100, agoMs: 11 * DAY
  },
  {
    champ: C.Nunu, k: 4, d: 4, a: 18, cs: 188, win: true, mins: 29, secs: 18,
    queueId: 420, position: 'JUNGLE', spells: [S.Smite, S.Flash], keystone: 'PhaseRush',
    items: ITEMS_TANK, damage: 15_800, teamKills: 33, teamDamage: 80_000, gold: 12_400, agoMs: 12 * DAY
  },
  {
    champ: C.Viktor, k: 10, d: 2, a: 8, cs: 262, win: true, mins: 30, secs: 27,
    queueId: 420, position: 'MIDDLE', spells: [S.Teleport, S.Flash], keystone: 'DarkHarvest',
    items: ITEMS_AP, damage: 34_600, teamKills: 29, teamDamage: 95_000, gold: 16_200,
    multiKill: 2, agoMs: 13 * DAY
  }
]

export const MATCHES: MatchSummary[] = SEEDS.map((s, i) => ({
  matchId: `NA1_5${String(1000 - i).padStart(4, '0')}`,
  gameCreation: NOW - s.agoMs,
  gameDuration: s.mins * 60 + s.secs,
  gameMode: s.queueId === 450 ? 'ARAM' : 'CLASSIC',
  queueId: s.queueId,
  win: s.win,
  championId: s.champ,
  championName: null,
  champLevel: Math.min(18, 8 + Math.round(s.mins / 3)),
  kills: s.k,
  deaths: s.d,
  assists: s.a,
  cs: s.cs,
  goldEarned: s.gold,
  damageDealtToChampions: s.damage,
  largestMultiKill: s.multiKill ?? 1,
  items: s.items,
  summoner1Id: s.spells[0],
  summoner2Id: s.spells[1],
  perks: perks(s.keystone),
  teamPosition: s.position,
  teamKills: s.teamKills,
  teamDamage: s.teamDamage
}))

const FILLER_NAMES = [
  'MegabyteB', 'wonkybonky', 'Sink', 'lucius', 'Blade Of Light',
  'Pho', 'The Fool', 'Yup', 'Clone Diff', 'Acropt'
]

const FILLER_CHAMPS = [C.Aatrox, C.LeeSin, C.Ahri, C.Kaisa, C.Thresh, C.DrMundo, C.Vi, C.Syndra, C.Jhin, C.Leona]

/** Builds a full ten-player scoreboard around the tracked player's own row. */
function detailFor(summary: MatchSummary, index: number): MatchDetail {
  const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

  const participants: MatchParticipant[] = Array.from({ length: 10 }, (_, i) => {
    const onBlue = i < 5
    const isMe = i === 2
    const won = onBlue === summary.win

    if (isMe) {
      return {
        puuid: 'puuid-alluna',
        gameName: 'Alluna',
        tagLine: 'NA1',
        teamId: 100,
        win: summary.win,
        championId: summary.championId,
        championName: null,
        champLevel: summary.champLevel,
        kills: summary.kills,
        deaths: summary.deaths,
        assists: summary.assists,
        goldEarned: summary.goldEarned,
        cs: summary.cs,
        damageDealtToChampions: summary.damageDealtToChampions,
        damageTaken: 24_800,
        items: summary.items,
        summoner1Id: summary.summoner1Id,
        summoner2Id: summary.summoner2Id,
        perks: summary.perks,
        teamPosition: summary.teamPosition,
        largestMultiKill: summary.largestMultiKill
      }
    }

    const seed = (index * 7 + i * 13) % 10
    return {
      puuid: `puuid-filler-${i}`,
      // One participant with no resolved Riot ID, as spectator data sometimes returns.
      gameName: i === 7 ? null : FILLER_NAMES[seed],
      tagLine: i === 7 ? null : 'NA1',
      teamId: onBlue ? 100 : 200,
      win: won,
      championId: FILLER_CHAMPS[(index + i) % FILLER_CHAMPS.length],
      championName: null,
      champLevel: 12 + (seed % 6) + (won ? 1 : 0),
      // Skewed by result so the scoreboard reads like a real game: the winning
      // side out-kills and out-earns the losing one.
      kills: 2 + (seed % 7) + (won ? 4 : 0),
      deaths: 1 + (seed % 5) + (won ? 0 : 4),
      assists: 3 + (seed % 11) + (won ? 3 : 0),
      goldEarned: 8_000 + seed * 900 + (won ? 3_200 : 0),
      cs: positions[i % 5] === 'UTILITY' ? 12 + seed : 120 + seed * 17,
      damageDealtToChampions: 7_000 + seed * 3_900,
      damageTaken: 12_000 + seed * 2_600,
      items: [ITEMS_AD, ITEMS_AP, ITEMS_TANK, ITEMS_SUPPORT][seed % 4],
      summoner1Id: S.Flash,
      summoner2Id: [S.Ignite, S.Teleport, S.Smite, S.Heal][seed % 4],
      perks: perks((Object.keys(K) as Keystone[])[seed % Object.keys(K).length]),
      teamPosition: positions[i % 5],
      largestMultiKill: seed > 7 ? 2 : 1
    }
  })

  return {
    matchId: summary.matchId,
    gameCreation: summary.gameCreation,
    gameDuration: summary.gameDuration,
    gameMode: summary.gameMode,
    gameType: 'MATCHED_GAME',
    queueId: summary.queueId,
    participants
  }
}

export const MATCH_DETAILS: Record<string, MatchDetail> = Object.fromEntries(
  MATCHES.map((m, i) => [m.matchId, detailFor(m, i)])
)

export const MASTERY: MasteryEntry[] = [
  { championId: C.Viktor, championPoints: 412_886, championLevel: 7, lastPlayTime: NOW - 2 * HOUR },
  { championId: C.Ahri, championPoints: 198_204, championLevel: 7, lastPlayTime: NOW - 21 * HOUR },
  { championId: C.Zed, championPoints: 143_910, championLevel: 6, lastPlayTime: NOW - 3 * DAY },
  { championId: C.Syndra, championPoints: 98_450, championLevel: 6, lastPlayTime: NOW - 5 * DAY },
  { championId: C.Orianna, championPoints: 76_320, championLevel: 5, lastPlayTime: NOW - 4 * DAY },
  { championId: C.Jhin, championPoints: 54_190, championLevel: 5, lastPlayTime: NOW - 23 * HOUR },
  { championId: C.Yone, championPoints: 41_002, championLevel: 5, lastPlayTime: NOW - 3 * DAY },
  { championId: C.LeeSin, championPoints: 33_870, championLevel: 4, lastPlayTime: NOW - 5 * DAY },
  { championId: C.Nami, championPoints: 21_540, championLevel: 4, lastPlayTime: NOW - 2 * DAY },
  { championId: C.Sett, championPoints: 12_330, championLevel: 3, lastPlayTime: NOW - DAY }
]

/** Derived from MATCHES so the Champions view agrees with the match list. */
export const WIN_RATES: WinRateEntry[] = Object.values(
  MATCHES.reduce<Record<number, WinRateEntry>>((acc, m) => {
    const entry = acc[m.championId] ?? { championId: m.championId, games: 0, wins: 0 }
    entry.games += 1
    if (m.win) entry.wins += 1
    acc[m.championId] = entry
    return acc
  }, {})
)

export const LIVE_GAME: LiveGameData = {
  gameId: 5_100_200_300,
  gameMode: 'CLASSIC',
  gameLength: 847,
  participants: [
    { puuid: 'puuid-alluna', gameName: 'Alluna', tagLine: 'NA1', teamId: 100, championId: C.Viktor, spell1Id: S.Teleport, spell2Id: S.Flash, rank: LEAGUE_ENTRIES[1][0], rankLoading: false },
    { puuid: 'p-b1', gameName: 'Runnit Downy Jr', tagLine: 'NA1', teamId: 100, championId: C.Sett, spell1Id: S.Flash, spell2Id: S.Teleport, rank: { queueType: 'RANKED_SOLO_5x5', tier: 'PLATINUM', rank: 'I', leaguePoints: 88, wins: 40, losses: 33, fetchedAt: '' }, rankLoading: false },
    { puuid: 'p-b2', gameName: 'phantomduval', tagLine: 'NA1', teamId: 100, championId: C.Vi, spell1Id: S.Smite, spell2Id: S.Flash, rank: { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'III', leaguePoints: 12, wins: 28, losses: 30, fetchedAt: '' }, rankLoading: false },
    { puuid: 'p-b3', gameName: 'Killua', tagLine: 'NA1', teamId: 100, championId: C.Kaisa, spell1Id: S.Flash, spell2Id: S.Heal, rank: null, rankLoading: true },
    { puuid: 'p-b4', gameName: null, tagLine: null, teamId: 100, championId: C.Thresh, spell1Id: S.Flash, spell2Id: S.Ignite, rank: null, rankLoading: false },
    { puuid: 'p-r0', gameName: 'cpdd Ontario', tagLine: 'NA1', teamId: 200, championId: C.Aatrox, spell1Id: S.Teleport, spell2Id: S.Flash, rank: { queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', rank: 'IV', leaguePoints: 4, wins: 91, losses: 88, fetchedAt: '' }, rankLoading: false },
    { puuid: 'p-r1', gameName: 'jg TTVritchhi', tagLine: 'NA1', teamId: 200, championId: C.LeeSin, spell1Id: S.Smite, spell2Id: S.Flash, rank: { queueType: 'RANKED_SOLO_5x5', tier: 'MASTER', rank: 'I', leaguePoints: 231, wins: 155, losses: 140, fetchedAt: '' }, rankLoading: false },
    { puuid: 'p-r2', gameName: 'StayyKawaii', tagLine: 'NA1', teamId: 200, championId: C.Ahri, spell1Id: S.Flash, spell2Id: S.Ignite, rank: { queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0, wins: 3, losses: 21, fetchedAt: '' }, rankLoading: false },
    { puuid: 'p-r3', gameName: 'Harrowhold', tagLine: 'NA1', teamId: 200, championId: C.Jhin, spell1Id: S.Flash, spell2Id: S.Heal, rank: { queueType: 'RANKED_SOLO_5x5', tier: 'EMERALD', rank: 'II', leaguePoints: 55, wins: 66, losses: 61, fetchedAt: '' }, rankLoading: false },
    { puuid: 'p-r4', gameName: 'MightyPatriarch', tagLine: 'NA1', teamId: 200, championId: C.Leona, spell1Id: S.Flash, spell2Id: S.Exhaust, rank: null, rankLoading: false }
  ]
}
