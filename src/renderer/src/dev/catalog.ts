import type { MatchDetail, MatchParticipant, MatchSummary } from '@shared/types'

/**
 * Static game data and scoreboard scaffolding shared by every fixture.
 *
 * Split out of fixtures.ts so the generated climb in climb.ts can reuse it
 * without importing from the module that consumes it — the two would otherwise
 * form a cycle.
 *
 * Dev-only, same as its callers.
 */

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

/**
 * Fixed so relative timestamps ("2 hours ago") stay stable within a session.
 *
 * Shared by every fixture module so the two accounts' histories are measured
 * against one clock rather than two Date.now() calls milliseconds apart.
 */
export const NOW = Date.now()

/** Champion ids referenced by the fixtures, named for readability. */
export const C = {
  Maokai: 57,
  Nunu: 20,
  MissFortune: 21,
  DrMundo: 36,
  Malphite: 54,
  Orianna: 61,
  LeeSin: 64,
  Garen: 86,
  Leona: 89,
  Riven: 92,
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
export const S = {
  Cleanse: 1, Exhaust: 3, Flash: 4, Ghost: 6, Heal: 7,
  Smite: 11, Teleport: 12, Ignite: 14, Barrier: 21
}

/** Keystone ids paired with a secondary tree id. */
export const K = {
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

export type Keystone = keyof typeof K

/** Matches the `perks` shape match-v5 returns, as far as the UI reads it. */
export function perks(keystone: Keystone): unknown {
  const [perk, secondaryStyle] = K[keystone]
  return {
    statPerks: { defense: 5011, flex: 5008, offense: 5005 },
    styles: [
      { description: 'primaryStyle', style: secondaryStyle, selections: [{ perk }] },
      { description: 'subStyle', style: secondaryStyle, selections: [] }
    ]
  }
}

// Index 6 is the trinket, matching match-v5 — these had it at 5, which rendered
// it as a square inventory item and left an empty circle in the trinket slot.
// SUPPORT keeps an interior hole and AD a trailing one, so the harness shows
// both cases itemSlots has to pack.
export const ITEMS_AP = [1056, 3157, 3100, 2503, 3067, 3089, 3363]
export const ITEMS_AD = [6672, 3006, 3031, 1038, 6673, 0, 3363]
export const ITEMS_TANK = [3068, 3047, 3075, 3143, 1028, 3742, 3364]
export const ITEMS_SUPPORT = [3853, 0, 3011, 3222, 0, 3050, 3364]

/**
 * The role quest reward each lane finishes with.
 *
 * Bottom's is a pair of boots rather than a quest item, which is what made the
 * missing slot obvious in the first place. Lanes are keyed loosely so the ARAM
 * seed's empty teamPosition falls through to 0 and exercises the empty slot.
 */
export const ROLE_ITEM: Record<string, number> = {
  TOP: 1221,
  JUNGLE: 1209,
  MIDDLE: 1206,
  BOTTOM: 3009,
  UTILITY: 1208
}

const FILLER_NAMES = [
  'MegabyteB', 'wonkybonky', 'Sink', 'lucius', 'Blade Of Light',
  'Pho', 'The Fool', 'Yup', 'Clone Diff', 'Acropt'
]

const FILLER_CHAMPS = [C.Aatrox, C.LeeSin, C.Ahri, C.Kaisa, C.Thresh, C.DrMundo, C.Vi, C.Syndra, C.Jhin, C.Leona]

/** The tracked player's identity, which varies by account. */
export interface TrackedPlayer {
  puuid: string
  gameName: string
  tagLine: string
}

/** Builds a full ten-player scoreboard around the tracked player's own row. */
export function detailFor(
  summary: MatchSummary,
  index: number,
  me: TrackedPlayer
): MatchDetail {
  const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

  const participants: MatchParticipant[] = Array.from({ length: 10 }, (_, i) => {
    const onBlue = i < 5
    const isMe = i === 2
    const won = onBlue === summary.win

    if (isMe) {
      return {
        puuid: me.puuid,
        gameName: me.gameName,
        tagLine: me.tagLine,
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
        roleBoundItem: summary.roleBoundItem,
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
      tagLine: i === 7 ? null : me.tagLine,
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
      roleBoundItem: ROLE_ITEM[positions[i % 5]] ?? 0,
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
