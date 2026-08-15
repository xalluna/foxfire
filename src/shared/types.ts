export type QueueType = 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'

export interface Account {
  id: number
  puuid: string
  gameName: string
  tagLine: string
  platform: string
  regionalRoute: string
  summonerId: string | null
  profileIconId: number | null
  summonerLevel: number | null
  isHomeAccount: boolean
  createdAt: string
  updatedAt: string
}

export interface LeagueEntry {
  queueType: QueueType
  tier: string | null
  rank: string | null
  leaguePoints: number | null
  wins: number | null
  losses: number | null
  fetchedAt: string
}

/**
 * One row of match history.
 *
 * Everything here is read from the local `match_participants` table in a
 * single query — no Riot call is made to render a list. The team totals are
 * aggregates over the row's own team, needed for kill participation and
 * damage share, which are ratios rather than raw stats.
 */
export interface MatchSummary {
  matchId: string
  gameCreation: number
  gameDuration: number
  gameMode: string | null
  queueId: number | null
  win: boolean
  championId: number
  championName: string | null
  champLevel: number | null
  kills: number
  deaths: number
  assists: number
  cs: number | null
  goldEarned: number | null
  damageDealtToChampions: number | null
  /** Highest multi-kill in the game: 2 = double, 3 = triple, 4 = quadra, 5 = penta. */
  largestMultiKill: number | null
  items: number[]
  summoner1Id: number | null
  summoner2Id: number | null
  perks: unknown
  /** '' for modes without lanes (ARAM, Arena). */
  teamPosition: string | null
  /** Sum over the player's own team — the denominator for kill participation. */
  teamKills: number
  /** Sum over the player's own team — the denominator for damage share. */
  teamDamage: number
  /**
   * Voided a few minutes in because someone failed to connect. Still listed in
   * match history, but excluded from win rates, recent form and LP attribution
   * — no LP moves and the result says nothing about the champion.
   */
  isRemake: boolean
  /** Null for unranked queues, and for any game LP could not be attributed to. */
  rank: MatchRankInfo | null
}

/**
 * What a single game was worth on the ladder.
 *
 * Riot exposes no per-match LP, so this is derived by diffing rank snapshots.
 * It exists only when exactly one ranked game sat between two consecutive
 * snapshots — every other match carries null and renders no chip at all.
 */
export interface MatchRankInfo {
  lpDelta: number | null
  tierBefore: string | null
  rankBefore: string | null
  tierAfter: string | null
  rankAfter: string | null
  isPromotion: boolean
  isDemotion: boolean
}

/** One reading of a ladder position, appended rather than overwritten. */
export interface RankSnapshot {
  queueType: QueueType
  tier: string | null
  rank: string | null
  leaguePoints: number | null
  wins: number | null
  losses: number | null
  /** Precomputed by shared/ladder.ts so the graph plots without recomputing. */
  ladderPosition: number | null
  source: 'lcu' | 'league_v4'
  /** Epoch milliseconds, the same units as MatchSummary.gameCreation. */
  capturedAt: number
}

/** A crossed tier or division boundary, for the climb summary. */
export interface RankMilestone {
  queueType: QueueType
  movement: 'promotion' | 'demotion'
  tier: string | null
  rank: string | null
  capturedAt: number
}

export interface RankHistory {
  snapshots: RankSnapshot[]
  milestones: RankMilestone[]
}

export type RankRange = '7d' | '30d' | 'all'

/**
 * Whether the League client is reachable and whose account is logged into it.
 *
 * 'untracked' is its own state rather than an error: the client is running fine,
 * it is just signed in as somebody this app does not follow, and the only
 * sensible response is to offer to add them.
 */
export type LcuStatus =
  | { state: 'disconnected' }
  | { state: 'connected'; accountId: number; gameName: string; tagLine: string }
  | { state: 'untracked'; gameName: string; tagLine: string }

export interface BackgroundSettings {
  /** Keep running in the tray after the window is closed. */
  runInTray: boolean
  /** Opt-in, default off. */
  launchAtStartup: boolean
  /** Overrides League client auto-detection when the install is somewhere unusual. */
  lcuInstallPath: string | null
}

export interface MatchParticipant {
  puuid: string
  gameName: string | null
  tagLine: string | null
  teamId: number
  win: boolean
  championId: number
  championName: string | null
  champLevel: number | null
  kills: number
  deaths: number
  assists: number
  goldEarned: number | null
  cs: number | null
  damageDealtToChampions: number | null
  damageTaken: number | null
  items: number[]
  summoner1Id: number | null
  summoner2Id: number | null
  perks: unknown
  teamPosition: string | null
  largestMultiKill: number | null
}

export interface MatchDetail {
  matchId: string
  gameCreation: number
  gameDuration: number
  gameMode: string | null
  gameType: string | null
  queueId: number | null
  participants: MatchParticipant[]
}

export interface MasteryEntry {
  championId: number
  championPoints: number
  championLevel: number
  lastPlayTime: number | null
}

export interface WinRateEntry {
  championId: number
  games: number
  wins: number
}

export interface SyncState {
  accountId: number
  mostRecentMatchId: string | null
  backfillComplete: boolean
  backfillTarget: number
  lastFullSyncAt: string | null
  lastDeltaSyncAt: string | null
}

export interface SyncProgressEvent {
  accountId: number
  phase: 'backfill' | 'delta' | 'complete' | 'error'
  current: number
  total: number
  message?: string
}

export interface LiveGameParticipant {
  puuid: string
  gameName: string | null
  tagLine: string | null
  teamId: number
  championId: number
  spell1Id: number
  spell2Id: number
  rank: LeagueEntry | null
  rankLoading: boolean
}

export interface LiveGameData {
  gameId: number
  gameMode: string
  gameLength: number
  participants: LiveGameParticipant[]
}

export interface AdHocSummonerResult {
  profile: {
    puuid: string
    gameName: string
    tagLine: string
    profileIconId: number
    summonerLevel: number
  }
  leagueEntries: LeagueEntry[]
  recentMatches: MatchSummary[]
}

export interface RiotIdInput {
  gameName: string
  tagLine: string
}

export interface AppSettingsPublic {
  hasApiKey: boolean
  homeAccountId: number | null
}

export type ApiKeyStatus = 'valid' | 'missing' | 'expired' | 'invalid'

export interface AssetManifest {
  version: string
  cdn: string
  championById: Record<number, { id: string; name: string }>
  spellById: Record<number, { id: string; name: string }>
  runeById: Record<number, { icon: string; name: string }>
}
