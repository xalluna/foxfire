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
  /**
   * The role quest reward, which match-v5 reports in its own slot.
   *
   * Kept out of `items` deliberately: it is granted by the lane rather than
   * bought, and it never appears among item0-6, so folding it in would redefine
   * what an inventory slot means for the sake of one array. 0 for modes without
   * lanes, and for matches played before the field existed.
   */
  roleBoundItem: number
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
  /**
   * Whether the user has hand-entered the rank after this game.
   *
   * Read only to decide which action a row's context menu offers — the LP it
   * produces renders identically to a derived one, so nothing else looks at it.
   */
  hasManualRank: boolean
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
  /**
   * Where the reading came from: the running client, the public API, or the
   * user. A 'manual' row is an assertion rather than a measurement, and is
   * dropped as soon as a real reading measures the same interval — see
   * manualRankService.
   */
  source: SnapshotSource
  /** Epoch milliseconds, the same units as MatchSummary.gameCreation. */
  capturedAt: number
}

export type SnapshotSource = 'lcu' | 'league_v4' | 'manual'

/** A rank the user can type: tier plus, below Master, a division and LP. */
export interface ManualRank {
  tier: string
  /** Null for the apex tiers, which have no divisions. */
  rank: string | null
  leaguePoints: number
}

/**
 * A ranked game with no attributed LP, offered for hand-entry.
 *
 * Carries enough of the match to recognise it in a list, plus the rank going
 * in, so the editor can show what the game moved from without a second query.
 */
export interface EditableMatch {
  matchId: string
  gameCreation: number
  gameDuration: number
  win: boolean
  championId: number
  championName: string | null
  kills: number
  deaths: number
  assists: number
  /** The most recent reading before this game, or null if there is none. */
  before: ManualRank | null
  /**
   * When that reading was taken, or null if there is none.
   *
   * Identifies the interval a game sits in: consecutive games sharing this
   * value are the ones a single ambiguous stretch swallowed. The editor uses it
   * to chain a preview — once the rank after one game is entered, that is what
   * the next game in the same stretch actually starts from.
   */
  beforeAt: number | null
  /**
   * Whether `before` can anchor a delta. False when nothing precedes the game
   * or the reading was unranked — attributeInterval bails on a null ladder
   * position, so the editor must collect the before state too rather than
   * saving to no visible effect.
   */
  beforeUsable: boolean
  /** The user's existing entry for this game, if they have already made one. */
  manual: ManualRank | null
}

/** One row of the editor, as submitted. */
export interface ManualRankEdit {
  matchId: string
  after: ManualRank
  /** Only sent for a game whose preceding reading is unusable. */
  before?: ManualRank | null
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
  /** The lane's quest reward — see MatchSummary.roleBoundItem. */
  roleBoundItem: number
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

/**
 * One champion's record over the synced matches, scoped to the selected queue.
 *
 * Deliberately ships totals rather than pre-divided averages: the view needs
 * both a per-game figure and a per-minute rate from the same sums, and sending
 * the totals keeps the two from disagreeing by a rounding step.
 */
export interface ChampionStats {
  championId: number
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  cs: number
  damageToChampions: number
  /** Summed across the counted games — the denominator for CS/min and DPM. */
  durationSeconds: number
  /** Mean of the per-game shares. Null when every counted game had a shut-out team. */
  damageShare: number | null
  killParticipation: number | null
}

export interface SyncState {
  accountId: number
  mostRecentMatchId: string | null
  backfillComplete: boolean
  backfillTarget: number
  lastFullSyncAt: string | null
  lastDeltaSyncAt: string | null
}

/**
 * Who asked for a sync.
 *
 * 'auto' covers the launch sweep and the post-game retries — work the user did
 * not initiate and should not have to watch. The events still fire either way;
 * only their presentation differs.
 */
export type SyncTrigger = 'manual' | 'auto'

export interface SyncProgressEvent {
  accountId: number
  phase: 'backfill' | 'delta' | 'complete' | 'error'
  current: number
  total: number
  message?: string
  trigger: SyncTrigger
}

export interface LiveGameParticipant {
  /** Position in Riot's participant array. The React key, since an anonymous player has no puuid. */
  slot: number
  /** Riot withheld this player's identity — no name, no rank, nothing to look them up by. */
  anonymous: boolean
  /** Null on anonymous rows, dropped on purpose so the renderer cannot resolve what Riot withheld. */
  puuid: string | null
  gameName: string | null
  tagLine: string | null
  teamId: number
  championId: number | null
  spell1Id: number | null
  spell2Id: number | null
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
  /**
   * A stored key that Riot has since rejected — normally an expired personal
   * key. Readable state rather than only an event, so a rejection that happens
   * before the window is listening still reaches the user.
   */
  keyRejected: boolean
}

export type ApiKeyStatus = 'valid' | 'missing' | 'expired' | 'invalid'

export interface AssetManifest {
  version: string
  cdn: string
  championById: Record<number, { id: string; name: string }>
  spellById: Record<number, { id: string; name: string }>
  runeById: Record<number, { icon: string; name: string }>
}
