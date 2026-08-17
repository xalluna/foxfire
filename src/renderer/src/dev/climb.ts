import type {
  LeagueEntry,
  MatchDetail,
  MatchRankInfo,
  MatchSummary,
  RankSnapshot
} from '@shared/types'
import { ladderPosition, rankAtPosition, rankMovement } from '@shared/ladder'
import {
  C,
  DAY,
  HOUR,
  ITEMS_AD,
  ITEMS_AP,
  ITEMS_SUPPORT,
  ITEMS_TANK,
  NOW,
  S,
  detailFor,
  perks,
  type Keystone,
  type TrackedPlayer
} from './catalog'

/**
 * A 30-day one-trick climb, generated rather than hand-written.
 *
 * Alluna's fixture in fixtures.ts is 27 hand-tuned games chosen to break
 * layouts. This one exists for the opposite reason: it is the volume case — a
 * 301-game history where the Champions screen has a real distribution to rank,
 * the match list has enough rows to page through, and the rank chart has a
 * month-long climb rather than a week of noise.
 *
 * Everything is derived from the two tables below and a seeded PRNG, so the
 * harness renders identically on every run while still looking un-uniform.
 */

const ME: TrackedPlayer = {
  puuid: 'puuid-smurf',
  gameName: 'AbsolutelyEnormousName',
  tagLine: 'EUW'
}

const START = ladderPosition({ tier: 'SILVER', rank: 'II', leaguePoints: 0 }) ?? 0
const TARGET = ladderPosition({ tier: 'PLATINUM', rank: 'III', leaguePoints: 40 }) ?? 0

/** Every game moves exactly this much, win or lose. */
const LP_PER_GAME = 20

/**
 * Games played on each of the 30 days, and how many of them were won.
 *
 * Written out rather than generated because three constraints have to hold at
 * once and only a fixed table can be checked by eye: the totals are 301 games
 * and 169 wins, which is the only whole-number split that walks Silver II 0 LP
 * to Platinum III 40 LP at a flat ±20 LP a game. (740 LP of progress needs
 * wins − losses = 37, and 37 is odd, so an exactly-300-game month cannot land
 * on it — hence a daily count that drifts between 8 and 12 rather than a rigid
 * 10, which is closer to how anyone actually plays.)
 *
 * The shape is deliberate: a rough first week around Silver, a real slump on
 * day 6, plateaus where the climb stalls at a promotion, and a strong finish.
 */
const GAMES_PER_DAY = [
  9, 11, 10, 8, 12, 10, 9, 11, 10, 10,
  12, 8, 10, 11, 9, 10, 10, 12, 9, 11,
  10, 8, 11, 10, 10, 9, 12, 10, 10, 9
]

const WINS_PER_DAY = [
  4, 7, 4, 5, 5, 3, 6, 7, 5, 5,
  8, 4, 6, 6, 4, 7, 5, 8, 4, 6,
  6, 3, 7, 6, 7, 5, 8, 6, 6, 6
]

const TOTAL_GAMES = GAMES_PER_DAY.reduce((a, b) => a + b, 0)
const TOTAL_WINS = WINS_PER_DAY.reduce((a, b) => a + b, 0)

/** Sessions run 10:00 to 19:00, so a day's games are spread over nine hours. */
const SESSION_START_HOUR = 10
const SESSION_MS = 9 * HOUR

/** The tightest believable pace, once queue and champion select are counted. */
const MIN_GAME_GAP = 20 * 60_000

interface Profile {
  position: string
  spells: [number, number]
  keystone: Keystone
  items: number[]
  csPerMin: number
  kills: number
  deaths: number
  assists: number
  damagePerMin: number
}

const PROFILES: Record<number, Profile> = {
  [C.Ahri]:    { position: 'MIDDLE',  spells: [S.Flash, S.Ignite],   keystone: 'Electrocute',     items: ITEMS_AP,      csPerMin: 7.4, kills: 8, deaths: 5, assists: 8,  damagePerMin: 1000 },
  [C.Viktor]:  { position: 'MIDDLE',  spells: [S.Teleport, S.Flash], keystone: 'ArcaneComet',     items: ITEMS_AP,      csPerMin: 8.2, kills: 7, deaths: 4, assists: 7,  damagePerMin: 1050 },
  [C.Lux]:     { position: 'MIDDLE',  spells: [S.Flash, S.Barrier],  keystone: 'ArcaneComet',     items: ITEMS_AP,      csPerMin: 6.6, kills: 6, deaths: 5, assists: 12, damagePerMin: 950 },
  [C.Riven]:   { position: 'TOP',     spells: [S.Flash, S.Ignite],   keystone: 'Conqueror',       items: ITEMS_AD,      csPerMin: 7.6, kills: 7, deaths: 5, assists: 5,  damagePerMin: 880 },
  [C.Maokai]:  { position: 'TOP',     spells: [S.Flash, S.Teleport], keystone: 'Grasp',           items: ITEMS_TANK,    csPerMin: 5.9, kills: 3, deaths: 5, assists: 10, damagePerMin: 520 },
  [C.Kaisa]:   { position: 'BOTTOM',  spells: [S.Flash, S.Heal],     keystone: 'PressTheAttack',  items: ITEMS_AD,      csPerMin: 8.8, kills: 8, deaths: 6, assists: 7,  damagePerMin: 1150 },
  [C.Jhin]:    { position: 'BOTTOM',  spells: [S.Flash, S.Heal],     keystone: 'LethalTempo',     items: ITEMS_AD,      csPerMin: 8.4, kills: 7, deaths: 4, assists: 9,  damagePerMin: 1080 },
  [C.Jinx]:    { position: 'BOTTOM',  spells: [S.Flash, S.Heal],     keystone: 'LethalTempo',     items: ITEMS_AD,      csPerMin: 8.6, kills: 9, deaths: 6, assists: 8,  damagePerMin: 1180 },
  [C.LeeSin]:  { position: 'JUNGLE',  spells: [S.Smite, S.Flash],    keystone: 'Conqueror',       items: ITEMS_AD,      csPerMin: 5.6, kills: 6, deaths: 6, assists: 9,  damagePerMin: 680 },
  [C.Vi]:      { position: 'JUNGLE',  spells: [S.Smite, S.Flash],    keystone: 'Electrocute',     items: ITEMS_AD,      csPerMin: 5.4, kills: 6, deaths: 6, assists: 10, damagePerMin: 650 },
  [C.Nunu]:    { position: 'JUNGLE',  spells: [S.Smite, S.Flash],    keystone: 'PhaseRush',       items: ITEMS_TANK,    csPerMin: 5.0, kills: 4, deaths: 5, assists: 14, damagePerMin: 540 },
  [C.Thresh]:  { position: 'UTILITY', spells: [S.Flash, S.Ignite],   keystone: 'Aftershock',      items: ITEMS_SUPPORT, csPerMin: 0.8, kills: 2, deaths: 7, assists: 18, damagePerMin: 330 },
  [C.Leona]:   { position: 'UTILITY', spells: [S.Flash, S.Ignite],   keystone: 'Aftershock',      items: ITEMS_SUPPORT, csPerMin: 0.7, kills: 2, deaths: 8, assists: 17, damagePerMin: 310 },
  [C.Nami]:    { position: 'UTILITY', spells: [S.Flash, S.Exhaust],  keystone: 'Guardian',        items: ITEMS_SUPPORT, csPerMin: 0.6, kills: 2, deaths: 6, assists: 20, damagePerMin: 300 }
}

/**
 * How the 301 games divide, as exact win/loss counts per champion.
 *
 * Counts rather than percentages because the totals have to land precisely on
 * 169-132 for the climb to finish where it should. They encode the requested
 * distribution: 85% mid (Ahri 80 / Viktor 15 / Lux 5 within it), 10% top
 * (Riven 60 / Maokai 40), and 5% autofilled across the other three roles.
 *
 * The win rates are deliberately uneven — the one-trick outperforms on Ahri and
 * is close to a coin flip everywhere else, worst of all when autofilled — so
 * the Champions screen has something to actually rank.
 */
const POOL: Array<{ champ: number; wins: number; losses: number }> = [
  { champ: C.Ahri, wins: 121, losses: 84 }, // 205 games, 59%
  { champ: C.Viktor, wins: 21, losses: 17 }, //  38 games, 55%
  { champ: C.Lux, wins: 6, losses: 7 }, //  13 games, 46%
  { champ: C.Riven, wins: 9, losses: 9 }, //  18 games, 50%
  { champ: C.Maokai, wins: 6, losses: 6 }, //  12 games, 50%
  { champ: C.Kaisa, wins: 1, losses: 1 },
  { champ: C.Jhin, wins: 1, losses: 1 },
  { champ: C.Jinx, wins: 0, losses: 1 },
  { champ: C.LeeSin, wins: 1, losses: 1 },
  { champ: C.Vi, wins: 1, losses: 1 },
  { champ: C.Nunu, wins: 0, losses: 1 },
  { champ: C.Thresh, wins: 1, losses: 1 },
  { champ: C.Leona, wins: 1, losses: 1 },
  { champ: C.Nami, wins: 0, losses: 1 }
]

/** Deterministic PRNG, so the harness renders identically on every run. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const random = makeRandom(0x5eed1e)

/** Jitters a base value by ±`spread` (as a fraction) and rounds it. */
function vary(base: number, spread: number): number {
  return Math.round(base * (1 - spread + random() * spread * 2))
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Arranges a day's results into runs rather than alternating them.
 *
 * Real sessions come in streaks, and a strictly interleaved day would draw the
 * rank chart as a flat sawtooth. Run lengths are weighted by what is left to
 * place, so a lopsided day still uses up its results without a long tail of
 * identical games at the end.
 */
function streaks(wins: number, losses: number): boolean[] {
  const out: boolean[] = []
  let w = wins
  let l = losses

  while (w + l > 0) {
    const won = w > 0 && (l === 0 || random() < w / (w + l))
    const run = Math.min(won ? w : l, 1 + Math.floor(random() * 3))
    for (let i = 0; i < run; i++) out.push(won)
    if (won) w -= run
    else l -= run
  }

  return out
}

/**
 * Where the month ends: the most recent session, and how much of it has run.
 *
 * Today counts once it has closed, and counts as a session still in progress
 * while enough of the day has passed to have played its games at a believable
 * pace — the newest match then lands shortly before now, which is what the
 * "2 hours ago" column is designed to show.
 *
 * The alternative, always ending on yesterday, pushes the oldest game a few
 * hours past the 30-day mark, and the Rank screen's default 30-day range then
 * opens part-way up the climb instead of at its start.
 */
function lastSession(): { start: number; window: number } {
  const today = new Date(NOW)
  today.setHours(SESSION_START_HOUR, 0, 0, 0)

  const elapsed = NOW - today.getTime()
  const needed = GAMES_PER_DAY[GAMES_PER_DAY.length - 1] * MIN_GAME_GAP

  if (elapsed >= SESSION_MS) return { start: today.getTime(), window: SESSION_MS }
  // Squeeze the final day into the hours that have actually happened, leaving a
  // gap so the newest game reads as finished rather than as in progress.
  if (elapsed >= needed) return { start: today.getTime(), window: elapsed - MIN_GAME_GAP }

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  return { start: yesterday.getTime(), window: SESSION_MS }
}

const LAST_SESSION = lastSession()

/** Start of the session on the given day index, 0 being the oldest. */
function sessionStart(dayIndex: number): number {
  const day = new Date(LAST_SESSION.start)
  day.setDate(day.getDate() - (GAMES_PER_DAY.length - 1 - dayIndex))
  return day.getTime()
}

/** How long the given day's session ran; only the newest one can be cut short. */
function sessionWindow(dayIndex: number): number {
  return dayIndex === GAMES_PER_DAY.length - 1 ? LAST_SESSION.window : SESSION_MS
}

const matchIdAt = (index: number): string => `EUW1_6${String(1000 + index).padStart(4, '0')}`

interface Game {
  at: number
  win: boolean
  champ: number
}

/** Every game in chronological order, with its champion already assigned. */
function schedule(): Game[] {
  // Two bags, drawn from independently, so the per-champion win rates above
  // hold exactly no matter how the wins and losses fall across the month.
  const winBag = shuffled(POOL.flatMap((p) => Array<number>(p.wins).fill(p.champ)))
  const lossBag = shuffled(POOL.flatMap((p) => Array<number>(p.losses).fill(p.champ)))

  const games: Game[] = []

  for (const [dayIndex, count] of GAMES_PER_DAY.entries()) {
    const results = streaks(WINS_PER_DAY[dayIndex], count - WINS_PER_DAY[dayIndex])
    const start = sessionStart(dayIndex)
    // Evenly spaced across the window, which over a full nine hours at 8-12
    // games a day works out to a game every 45-67 minutes — about right once
    // queue and champion select are counted alongside the game itself.
    const gap = sessionWindow(dayIndex) / count

    for (const [n, win] of results.entries()) {
      games.push({
        at: Math.round(start + n * gap),
        win,
        champ: (win ? winBag : lossBag).pop() as number
      })
    }
  }

  return games
}

/**
 * Turns a scheduled game into a match summary with plausible numbers.
 *
 * Stats are derived per minute from the champion's profile and then skewed by
 * the result, so a won game reads like one: more kills, fewer deaths, a shorter
 * clock. `rank` is filled in afterwards by the ladder walk.
 */
function summaryFor(game: Game, index: number): MatchSummary {
  const p = PROFILES[game.champ]
  const mins = vary(game.win ? 28 : 31, 0.18)
  const secs = Math.floor(random() * 60)

  const kills = Math.max(0, vary(p.kills * (game.win ? 1.25 : 0.75), 0.35))
  const deaths = Math.max(0, vary(p.deaths * (game.win ? 0.75 : 1.3), 0.3))
  const assists = Math.max(0, vary(p.assists * (game.win ? 1.15 : 0.85), 0.3))
  const cs = Math.max(0, vary(p.csPerMin * mins, 0.12))
  const damage = Math.max(0, vary(p.damagePerMin * mins, 0.2))

  // Derived from the player's own share rather than invented, so the damage and
  // kill-participation columns stay in a believable band.
  const killParticipation = 0.55 + random() * 0.2
  const teamKills = Math.max(kills + assists, Math.round((kills + assists) / killParticipation))
  const damageShare = p.position === 'UTILITY' ? 0.1 + random() * 0.04 : 0.24 + random() * 0.09
  const teamDamage = Math.round(damage / damageShare)

  return {
    matchId: matchIdAt(index),
    gameCreation: game.at,
    gameDuration: mins * 60 + secs,
    gameMode: 'CLASSIC',
    queueId: 420,
    win: game.win,
    championId: game.champ,
    championName: null,
    champLevel: Math.min(18, 8 + Math.round(mins / 3)),
    kills,
    deaths,
    assists,
    cs,
    goldEarned: Math.round(
      mins * (p.position === 'UTILITY' ? 300 : 430) + kills * 250 + assists * 90
    ),
    damageDealtToChampions: damage,
    largestMultiKill: game.win && kills >= 10 ? (kills >= 15 ? 3 : 2) : 1,
    items: p.items,
    summoner1Id: p.spells[0],
    summoner2Id: p.spells[1],
    perks: perks(p.keystone),
    teamPosition: p.position,
    teamKills,
    teamDamage,
    isRemake: false,
    rank: null,
    hasManualRank: false
  }
}

/**
 * Walks the month oldest-first, moving the ladder by a flat ±20 LP a game.
 *
 * One walk feeds both the rank chart and the per-match LP chips, the same way
 * fixtures.ts does it, so a promotion marker on the graph always corresponds to
 * a badge on the game that caused it.
 */
function buildClimb(): {
  matches: MatchSummary[]
  snapshots: RankSnapshot[]
  entry: LeagueEntry
} {
  const games = schedule()
  const summaries = games.map(summaryFor)

  const snapshots: RankSnapshot[] = []
  let position = START
  let wins = 0
  let losses = 0

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
      capturedAt: at
    }
  }

  // An anchor an hour before the first game, so that game has a "before" to
  // diff against — the same convention the hand-written fixture uses.
  snapshots.push(snapshot(games[0].at - HOUR))

  for (const [index, game] of games.entries()) {
    const before = snapshots[snapshots.length - 1]
    const delta = game.win ? LP_PER_GAME : -LP_PER_GAME

    position = Math.max(0, position + delta)
    if (game.win) wins += 1
    else losses += 1

    const after = snapshot(game.at)
    snapshots.push(after)

    const movement = rankMovement(before, after)
    summaries[index].rank = {
      lpDelta: delta,
      tierBefore: before.tier,
      rankBefore: before.rank,
      tierAfter: after.tier,
      rankAfter: after.rank,
      isPromotion: movement === 'promotion',
      isDemotion: movement === 'demotion'
    } satisfies MatchRankInfo
  }

  const final = rankAtPosition(position)

  return {
    // The match list reads newest-first, the ladder walk runs oldest-first.
    matches: [...summaries].reverse(),
    snapshots,
    entry: {
      queueType: 'RANKED_SOLO_5x5',
      tier: final.tier,
      rank: final.rank,
      leaguePoints: final.leaguePoints,
      wins,
      losses,
      fetchedAt: new Date(games[games.length - 1].at).toISOString()
    }
  }
}

const climb = buildClimb()

export const CLIMB_MATCHES = climb.matches
export const CLIMB_SNAPSHOTS = climb.snapshots
export const CLIMB_ENTRY = climb.entry

export const CLIMB_DETAILS: Record<string, MatchDetail> = Object.fromEntries(
  CLIMB_MATCHES.map((m, i) => [m.matchId, detailFor(m, i, ME)])
)

/**
 * Mastery points that agree with the match history above.
 *
 * Scaled off the games actually played this month plus a plausible lifetime
 * head start, so the mastery screen cannot contradict the champion table.
 */
export const CLIMB_MASTERY = POOL.map(({ champ, wins, losses }) => {
  const games = wins + losses
  const lastPlayed = CLIMB_MATCHES.find((m) => m.championId === champ)?.gameCreation ?? NOW - DAY
  return {
    championId: champ,
    championPoints: games * 1_450 + (champ === C.Ahri ? 240_000 : games * 600),
    championLevel: games > 100 ? 7 : games > 30 ? 6 : games > 12 ? 5 : 4,
    lastPlayTime: lastPlayed
  }
}).sort((a, b) => b.championPoints - a.championPoints)

// Guard rails: these are the three facts the whole fixture rests on, and a
// mistyped digit in either table above would otherwise surface as a subtly
// wrong chart rather than as an error.
if (TOTAL_GAMES !== 301 || TOTAL_WINS !== 169) {
  throw new Error(`climb fixture: expected 301 games and 169 wins, got ${TOTAL_GAMES}/${TOTAL_WINS}`)
}
if (climb.snapshots[climb.snapshots.length - 1].ladderPosition !== TARGET) {
  throw new Error(
    `climb fixture: ended at ${climb.snapshots[climb.snapshots.length - 1].ladderPosition}, expected ${TARGET}`
  )
}
