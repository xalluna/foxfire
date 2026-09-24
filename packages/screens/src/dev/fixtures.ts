import type {
  Account,
  ChampionStats,
  LeagueEntry,
  MasteryEntry,
  MatchDetail,
  MatchRankInfo,
  MatchRecording,
  MatchSummary,
  QueueType,
  RankRange,
  RankSnapshot,
} from '@foxfire/core'
import { ladderPosition, rankAtPosition, rankMovement, rangeBounds } from '@foxfire/core'
import { FIXTURE_VIDEO_ID, fixtureRecording } from './recordings'
import { devSeasonIdAt } from './seasons'
import {
  C,
  DAY,
  HOUR,
  ITEMS_AD,
  ITEMS_AP,
  ITEMS_SUPPORT,
  ITEMS_TANK,
  NOW,
  ROLE_ITEM,
  S,
  detailFor,
  perks,
  type Keystone
} from './catalog'
import {
  CLIMB_DETAILS,
  CLIMB_ENTRY,
  CLIMB_MASTERY,
  CLIMB_MATCHES,
  CLIMB_SNAPSHOTS,
  PRIOR_DETAILS,
  PRIOR_MATCHES,
  PRIOR_SNAPSHOTS
} from './climb'

/**
 * Fixture data for the browser harnesses — the fixture client here, and the
 * desktop's own mock, which builds on it.
 *
 * Shaped after a real NA solo-queue history so the UI is designed against
 * plausible numbers rather than round ones. The list deliberately includes the
 * cases that break layouts: a perfect KDA, a support on single-digit CS, an
 * ARAM game with no lane assigned, an unranked flex queue, a name long enough
 * to need truncation, and a participant whose Riot ID never resolved.
 *
 * Dev-only — reached through @foxfire/screens/dev, which each app imports
 * lazily behind import.meta.env.DEV, so it is left out of production builds.
 */

export const ACCOUNTS: Account[] = [
  {
    id: '1',
    puuid: 'puuid-faker',
    gameName: 'Faker',
    tagLine: 'NA1',
    platform: 'na1',
    regionalRoute: 'americas',
    summonerId: 'sum-faker',
    profileIconId: 6299,
    summonerLevel: 412,
    isHomeAccount: true,
    createdAt: '2026-01-04T10:00:00Z',
    updatedAt: '2026-08-14T18:00:00Z',

    // Only meaningful connected to a server, where an account belongs to one
    // member and everybody else can read its games but not write its LP.
    isMine: true,
    ownerUsername: 'Faker'
  },
  {
    id: '2',
    // Long enough to exercise truncation in the 64px rail and the 320px card.
    puuid: 'puuid-smurf',
    gameName: 'AbsolutelyEnormousName',
    tagLine: 'EUW',
    platform: 'euw1',
    regionalRoute: 'europe',
    summonerId: 'sum-smurf',
    // Data Dragon has no icon 5789, which rendered as a blank tile in the rail.
    profileIconId: 5788,
    summonerLevel: 37,
    isHomeAccount: false,
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z'
  }
]

/**
 * Everybody else on the harness's server: the people the search box finds.
 *
 * Only there while connected — a local database has nobody but its own
 * accounts. Named so "fak" shows every rung of the ranking at once (Faker#KR1
 * exact, Fakest and Fakir starting with it, Snowfaker and Afakeaccount only
 * containing it), and with enough NA1 tags that "na1" runs past the ten a
 * search box shows.
 */
function communityAccount(
  id: string,
  riotId: string,
  profileIconId: number,
  summonerLevel: number,
  ownerUsername: string | null
): Account {
  const [gameName, tagLine] = riotId.split('#')
  return {
    id,
    puuid: `puuid-${id}`,
    gameName,
    tagLine,
    platform: tagLine === 'EUW' ? 'euw1' : tagLine === 'KR1' ? 'kr' : 'na1',
    regionalRoute: tagLine === 'EUW' ? 'europe' : tagLine === 'KR1' ? 'asia' : 'americas',
    summonerId: `sum-${id}`,
    profileIconId,
    summonerLevel,
    isHomeAccount: false,
    createdAt: '2026-03-01T10:00:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
    isMine: false,
    ownerUsername
  }
}

export const COMMUNITY: Account[] = [
  communityAccount('c1', 'Faker#KR1', 4834, 590, 'hideonbush'),
  communityAccount('c2', 'Fakest#NA1', 588, 121, 'fakest'),
  communityAccount('c3', 'Fakir#EUW', 3379, 64, null),
  communityAccount('c4', 'Snowfaker#NA1', 5212, 233, 'snow'),
  communityAccount('c5', 'Afakeaccount#NA1', 29, 30, null),
  communityAccount('c6', 'Nightfall#NA1', 4568, 188, 'nightfall'),
  communityAccount('c7', 'Mossbloom#NA1', 685, 76, 'moss'),
  communityAccount('c8', 'Quillon#NA1', 1394, 142, 'quill'),
  communityAccount('c9', 'Tidecaller#NA1', 5367, 305, 'tide'),
  communityAccount('c10', 'Emberlyn#NA1', 7, 98, 'ember'),
  communityAccount('c11', 'Vexwind#NA1', 6299, 211, null),
  communityAccount('c12', 'Lumen#NA1', 5788, 55, 'lumen'),
  communityAccount('c13', 'Hollowpine#NA1', 3505, 167, 'pine')
]

const soloEntry = (tier: string, rank: string, leaguePoints: number): LeagueEntry[] => [
  { queueType: 'RANKED_SOLO_5x5', tier, rank, leaguePoints, wins: 40, losses: 36, fetchedAt: '2026-08-20T10:00:00Z' }
]

export const LEAGUE_ENTRIES: Record<string, LeagueEntry[]> = {
  c1: soloEntry('CHALLENGER', 'I', 1402),
  c2: soloEntry('EMERALD', 'III', 28),
  c3: soloEntry('SILVER', 'I', 2),
  c4: soloEntry('PLATINUM', 'IV', 61),
  c6: soloEntry('DIAMOND', 'II', 45),
  c7: soloEntry('GOLD', 'IV', 12),
  c8: soloEntry('BRONZE', 'I', 88),
  c9: soloEntry('MASTER', 'I', 203),
  c10: soloEntry('SILVER', 'II', 70),
  c12: soloEntry('IRON', 'II', 34),
  c13: soloEntry('GOLD', 'I', 99),
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
    // Derived from the generated climb rather than hand-written, so the card can
    // never disagree with the graph and match list on the same screen.
    CLIMB_ENTRY,
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
  /** Voided game: listed in history, excluded from every stat. */
  remake?: boolean
  agoMs: number
}

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
    // A remake: someone never connected. Carries a nominal win in the payload
    // that must not reach any stat, and exercises the muted row treatment.
    champ: C.Leona, k: 0, d: 0, a: 1, cs: 8, win: true, mins: 1, secs: 14,
    queueId: 420, position: 'UTILITY', spells: [S.Flash, S.Ignite], keystone: 'Aftershock',
    items: [], damage: 210, teamKills: 1, teamDamage: 900, gold: 640,
    remake: true, agoMs: 5 * DAY + 16 * HOUR
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

export const matchIdAt = (index: number): string => `NA1_5${String(1000 - index).padStart(4, '0')}`

/**
 * Rank tracking begins part-way through this history.
 *
 * That mirrors the real constraint rather than papering over it: Riot exposes
 * no per-match LP, so games played before the app started snapshotting can
 * never be attributed. The older half of the list therefore renders an empty
 * chip, which is the state most users will actually see on day one.
 */
const TRACKING_STARTED = NOW - 8 * DAY

/** Fixed rather than random so the fixture renders identically every run. */
const WIN_LP = [21, 19, 23, 18, 22]
const LOSS_LP = [17, 20, 16, 19, 18]

const SOLO_START = ladderPosition({ tier: 'GOLD', rank: 'IV', leaguePoints: 40 }) ?? 0

/**
 * Walks the tracked ranked games oldest-first, applying an LP delta per result
 * and recording a snapshot after each. Deriving both the graph series and the
 * per-match chips from one walk keeps them consistent — a promotion marker on
 * the chart always corresponds to a badge on the match that caused it.
 */
function buildSoloRankHistory(): {
  snapshots: RankSnapshot[]
  byMatchId: Map<string, MatchRankInfo>
} {
  const steps = SEEDS.map((s, index) => ({
    index,
    at: NOW - s.agoMs,
    win: s.win,
    queueId: s.queueId,
    remake: s.remake ?? false
  }))
    // Remakes move no LP, so they get no step and no chip — the same rule the
    // real attribution applies.
    .filter((s) => s.queueId === 420 && !s.remake && s.at >= TRACKING_STARTED)
    .sort((a, b) => a.at - b.at)

  const snapshots: RankSnapshot[] = []
  const byMatchId = new Map<string, MatchRankInfo>()

  let position = SOLO_START
  let wins = 42
  let losses = 38

  const snapshot = (at: number): RankSnapshot => {
    const r = rankAtPosition(position)
    return {
      queueType: 'RANKED_SOLO_5x5',
      tier: r.tier,
      rank: r.rank,
      leaguePoints: r.leaguePoints,
      wins,
      losses,
      ladderPosition: position,
      source: 'lcu',
      capturedAt: at,
      seasonId: devSeasonIdAt(at)
    }
  }

  // An anchor shortly before the first tracked game, so that game has a
  // "before" to diff against. Offset by an hour rather than sitting exactly on
  // the cutoff, which would coincide with a game and draw a vertical step.
  snapshots.push(snapshot((steps[0]?.at ?? TRACKING_STARTED) - HOUR))

  // Games that record no snapshot of their own, standing in for a session
  // played with the League client closed. The ladder still moves across them,
  // but nothing observes it until the run ends — so one interval holds four
  // games, the total cannot be split, and all four come out with no LP.
  //
  // Without this every fixture game is unambiguous and the LP editor has
  // nothing to work on in the browser harness.
  const UNOBSERVED_RUN = { firstStep: 6, games: 4 }
  const unobserved = (n: number): boolean =>
    n >= UNOBSERVED_RUN.firstStep && n < UNOBSERVED_RUN.firstStep + UNOBSERVED_RUN.games - 1

  // The games since the last snapshot. Attribution can name a game's LP only
  // when this holds exactly one, which is the rule the real engine applies.
  let sinceSnapshot: number[] = []

  for (const [n, step] of steps.entries()) {
    const before = snapshots[snapshots.length - 1]
    const delta = step.win ? WIN_LP[n % WIN_LP.length] : -LOSS_LP[n % LOSS_LP.length]

    position = Math.max(0, position + delta)
    if (step.win) wins += 1
    else losses += 1
    sinceSnapshot.push(step.index)

    if (unobserved(n)) continue

    const after = snapshot(step.at)
    snapshots.push(after)

    if (sinceSnapshot.length === 1) {
      const movement = rankMovement(before, after)
      byMatchId.set(matchIdAt(sinceSnapshot[0]), {
        lpDelta: (after.ladderPosition ?? 0) - (before.ladderPosition ?? 0),
        tierBefore: before.tier,
        rankBefore: before.rank,
        tierAfter: after.tier,
        rankAfter: after.rank,
        isPromotion: movement === 'promotion',
        isDemotion: movement === 'demotion'
      })
    }
    sinceSnapshot = []
  }

  return { snapshots, byMatchId }
}

const soloHistory = buildSoloRankHistory()

const FAKER_SNAPSHOTS: Record<QueueType, RankSnapshot[]> = {
  RANKED_SOLO_5x5: soloHistory.snapshots,
  // Flex is deliberately sparse — the queue toggle has to stay legible when one
  // ladder has far fewer points than the other.
  RANKED_FLEX_SR: [
    { tier: 'SILVER', rank: 'I', leaguePoints: 12 },
    { tier: 'SILVER', rank: 'I', leaguePoints: 63 },
    { tier: 'GOLD', rank: 'IV', leaguePoints: 8 }
  ].map((r, i) => ({
    queueType: 'RANKED_FLEX_SR' as const,
    tier: r.tier,
    rank: r.rank,
    leaguePoints: r.leaguePoints,
    wins: 8 + i,
    losses: 7,
    ladderPosition: ladderPosition(r),
    source: 'league_v4' as const,
    capturedAt: NOW - (6 - i * 2) * DAY,
    seasonId: devSeasonIdAt(NOW - (6 - i * 2) * DAY)
  }))
}

/**
 * Rank history per account.
 *
 * Keyed by account because the real handler is: rank.history takes an
 * accountId, and a harness that ignored it would hide any bug where the app
 * shows one account's climb under another's name.
 */
export const RANK_SNAPSHOTS: Record<string, Record<QueueType, RankSnapshot[]>> = {
  1: FAKER_SNAPSHOTS,
  2: {
    // Two ranked years, oldest first. The gap between them is January's reset:
    // the all-time chart has to break the line there rather than draw a
    // thousand-point cliff, and no milestone may be reported across it.
    RANKED_SOLO_5x5: [...PRIOR_SNAPSHOTS, ...CLIMB_SNAPSHOTS],
    // The climb account's flex ladder was never played, so the queue toggle has
    // a genuinely empty series to render.
    RANKED_FLEX_SR: []
  }
}

const FAKER_MATCHES: MatchSummary[] = SEEDS.map((s, i) => ({
  matchId: matchIdAt(i),
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
  roleBoundItem: ROLE_ITEM[s.position] ?? 0,
  summoner1Id: s.spells[0],
  summoner2Id: s.spells[1],
  perks: perks(s.keystone),
  teamPosition: s.position,
  teamKills: s.teamKills,
  teamDamage: s.teamDamage,
  isRemake: s.remake ?? false,
  rank: soloHistory.byMatchId.get(matchIdAt(i)) ?? null,
  hasManualRank: false,
  local: {
    // The first three games were recorded; the rest were not, so the context
    // menu is exercised both enabled and disabled without switching scenario.
    recordingId: i < 3 ? i + 1 : null,
    // Of those, the newest is already on YouTube and the third is on its way —
    // so the menu shows upload offered, upload pending, and neither.
    recordingVideoId: i === 0 ? FIXTURE_VIDEO_ID : null,
    recordingUploadPending: i === 2,
    // Overlaps the recordings deliberately: the mock has to exercise a row with
    // both artefacts, one with each, and one with neither.
    replayId: i < 5 && i !== 1 ? i + 1 : null
  }
}))

const FAKER = { puuid: 'puuid-faker', gameName: 'Faker', tagLine: 'NA1' }

/**
 * Match history per account.
 *
 * Faker's 27 games are hand-tuned to break layouts; the second account's 301
 * are generated (see climb.ts) to cover the volume case the hand-written list
 * cannot — paging, a champion pool with a real distribution, a month of rank.
 */
export const MATCHES: Record<string, MatchSummary[]> = {
  1: FAKER_MATCHES,
  // Newest first across both seasons: each block is already reversed, and the
  // prior one is wholly older, so concatenating keeps the list ordered.
  2: [...CLIMB_MATCHES, ...PRIOR_MATCHES]
}

/**
 * What the harness's server holds on YouTube, keyed `account:match`.
 *
 * Faker's newest game, which is also on this disk, and his fourth, which only
 * the server has — a link somebody pasted, so it plays without markers. The
 * second account has none, so its rows show the other side of every question.
 */
export const MATCH_RECORDINGS: Record<string, MatchRecording> = {
  [`1:${FAKER_MATCHES[0]!.matchId}`]: fixtureRecording(FAKER_MATCHES[0]!, 'upload'),
  [`1:${FAKER_MATCHES[3]!.matchId}`]: fixtureRecording(FAKER_MATCHES[3]!, 'link')
}

/** Keyed by match id across both accounts, which is how the detail view looks them up. */
export const MATCH_DETAILS: Record<string, MatchDetail> = {
  ...Object.fromEntries(FAKER_MATCHES.map((m, i) => [m.matchId, detailFor(m, i, FAKER)])),
  ...CLIMB_DETAILS,
  ...PRIOR_DETAILS
}

const FAKER_MASTERY: MasteryEntry[] = [
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

/** Riot mastery per account — lifetime, so never scoped to a queue. */
export const MASTERY: Record<string, MasteryEntry[]> = {
  1: FAKER_MASTERY,
  2: CLIMB_MASTERY
}

/**
 * Champion stats over the visible match list, optionally scoped to a queue.
 *
 * Derived rather than hand-written so the harness can never show a stat that
 * disagrees with the matches on screen — which is exactly the class of bug the
 * queue filter exists to fix.
 *
 * Mirrors getChampionStats field for field, including its split between pooled
 * totals and per-game-meaned shares. Diverging here would make the web harness
 * quietly lie about arithmetic the real app gets right.
 */
export function championStatsFor(
  accountId: string,
  queueId: number | null,
  range: RankRange = 'all'
): ChampionStats[] {
  // Per-game shares are accumulated separately from the totals: they are meaned
  // over the games that had a share to give, not over every game played.
  const shares = new Map<number, { damage: number[]; kp: number[] }>()

  const mean = (xs: number[]): number | null =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length

  const { sinceMs, untilMs } = rangeBounds(range)

  const stats = (MATCHES[accountId] ?? []).filter(
    // Mirrors getChampionStats, which excludes remakes and scopes to a period.
    (m) =>
      !m.isRemake &&
      (queueId === null || m.queueId === queueId) &&
      (sinceMs === null || m.gameCreation >= sinceMs) &&
      (untilMs === null || m.gameCreation < untilMs)
  ).reduce<Record<number, ChampionStats>>((acc, m) => {
    const entry = acc[m.championId] ?? {
      championId: m.championId,
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      cs: 0,
      damageToChampions: 0,
      durationSeconds: 0,
      damageShare: null,
      killParticipation: null
    }

    entry.games += 1
    if (m.win) entry.wins += 1
    entry.kills += m.kills
    entry.deaths += m.deaths
    entry.assists += m.assists
    entry.cs += m.cs ?? 0
    entry.damageToChampions += m.damageDealtToChampions ?? 0
    entry.durationSeconds += m.gameDuration

    const bucket = shares.get(m.championId) ?? { damage: [], kp: [] }
    if (m.teamDamage > 0 && m.damageDealtToChampions !== null) {
      bucket.damage.push(m.damageDealtToChampions / m.teamDamage)
    }
    if (m.teamKills > 0) bucket.kp.push((m.kills + m.assists) / m.teamKills)
    shares.set(m.championId, bucket)

    acc[m.championId] = entry
    return acc
  }, {})

  return Object.values(stats)
    .map((entry) => ({
      ...entry,
      damageShare: mean(shares.get(entry.championId)?.damage ?? []),
      killParticipation: mean(shares.get(entry.championId)?.kp ?? [])
    }))
    .sort((a, b) => b.games - a.games)
}
