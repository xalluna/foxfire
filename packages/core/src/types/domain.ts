/**
 * The shapes of League data every Foxfire client reads.
 *
 * Moved here from the desktop's shared/types.ts when a web client arrived to
 * read them too. They are the wire format a Foxfire Server sends and the rows
 * the desktop's own SQLite answers with in local-only mode — the same type
 * either way, which is what lets one screen render against both.
 *
 * Nothing here knows about a machine. Recordings, Riot replays on disk, the
 * League client and OBS are the desktop's business and their types stay in
 * apps/desktop; the one place a match row can carry something from this
 * machine is `MatchSummary.local`, which only the desktop fills.
 */

export type QueueType = 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'

export interface Account {
  /**
   * Opaque. Whoever owns accounts chose it, and nothing here may take it apart.
   *
   * In local-only mode it is this machine's SQLite rowid written as text; on a
   * Foxfire Server it is that server's own id, which is a GUID. A screen
   * passes it back to whichever client it was handed and never reads it, which
   * is what lets the same screens work against either store.
   *
   * What crosses between the two is `gameName#tagLine`, not this. An id from
   * one server means nothing on another, and nothing at all locally.
   */
  id: string
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

  /**
   * Whether this is an account you have claimed, on a server where others have
   * claimed their own.
   *
   * Absent in local-only mode, where the question does not arise: every account
   * in the file is yours. On a server it decides what is writable — you can see
   * everybody's history and edit only your own LP.
   */
  isMine?: boolean

  /** Who claimed it, on a server. Absent in local-only mode, and null for unclaimed. */
  ownerUsername?: string | null
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
 * A replay the active server holds, as a match row advertises it.
 *
 * The patch and nothing else that matters: a .rofl only runs on the build that
 * produced it, and whether this machine has that build is decided here rather
 * than by the server, against the League installs it knows about.
 */
export interface SharedReplaySummary {
  patch: string | null
  fileBytes: number | null
}

/**
 * What this machine holds for one game, as a match row carries it.
 *
 * Read only to decide whether the row's context menu can offer to watch
 * something, so these are bare ids rather than the whole recording or replay.
 */
export interface LocalArtefacts {
  /** The recording of this game, when one exists. Scoped to the account it was recorded on. */
  recordingId: number | null
  /**
   * Riot's own replay for this game, when Foxfire has a copy.
   *
   * Unlike recordingId this is not scoped to the account: a .rofl is one file
   * per game on this machine, and the same file serves whoever played it.
   */
  replayId: number | null
}

/**
 * One row of match history.
 *
 * Everything here is read from a `match_participants` table — this machine's
 * or a server's — in a single query; no Riot call is made to render a list.
 * The team totals are aggregates over the row's own team, needed for kill
 * participation and damage share, which are ratios rather than raw stats.
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
  /**
   * The replay this server holds of the game, when it holds one.
   *
   * Null in local-only mode, where there is no server to hold one, and null on
   * a server nobody has uploaded this game to yet. Distinct from
   * `local.replayId`, which is a .rofl already on this disk: a row can have
   * one, both or neither, and the pair is what the context menu reads to
   * decide between offering a download and offering to watch.
   */
  sharedReplay?: SharedReplaySummary | null

  /**
   * Files this machine holds for the game: a recording, a Riot replay.
   *
   * Filled in by the desktop and nowhere else, and never on the wire. No server
   * can know what is on somebody's disk, and a browser has no disk to ask.
   * Absent means there is nothing to look for rather than that nothing was
   * found — which is what stops a server's match rows from advertising footage
   * that does not exist, as they did while these were two bare fields that an
   * absent value slipped past as `undefined !== null`.
   */
  local?: LocalArtefacts
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
  /** Precomputed by rules/ladder.ts so the graph plots without recomputing. */
  ladderPosition: number | null
  /**
   * Which season this reading falls in, stamped on the way out.
   *
   * Sent rather than derived so the renderer needs no copy of the season table
   * and cannot paint a chart before one has loaded. Null only when no seasons
   * are defined at all.
   */
  seasonId: number | null
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

/**
 * One hand-entered ranked season.
 *
 * Riot exposes no way to ask which season is current, and the calendar is not a
 * stand-in for one — 2026 opened on 8 January and a preseason can run into
 * February — so these are edited in Settings. See migration 008.
 *
 * A season runs from `startsAt` until the next one starts. The newest reaches
 * forwards forever and the oldest backwards forever, so no game can fall
 * outside every season and a boundary nobody has entered yet cannot cut the
 * current season short.
 */
export interface Season {
  id: number
  label: string
  /** Epoch milliseconds, matching game_creation and captured_at. */
  startsAt: number
  /** Labelled distinctly, but still catches games — rank carries into it. */
  isPreseason: boolean
  /**
   * Whether the ladder reset when this season opened.
   *
   * Distinct from the boundary itself: a season that carries rank forward must
   * keep attributing LP across its own start, and only a reset may suppress it.
   */
  resetsRank: boolean
}

/** A season on its way back from the editor. No id means a row being added. */
export type SeasonInput = Omit<Season, 'id'> & { id?: number }

/**
 * A window over rank history.
 *
 * `7d` and `30d` are relative to now; `season:12` names a season by its row id,
 * whose bounds come from rules/seasons.ts. They share one union because the
 * Rank screen offers them from a single control.
 */
export type RankRange = '7d' | '30d' | 'all' | `season:${number}`

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
  accountId: string
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
  accountId: string
  phase: 'backfill' | 'delta' | 'complete' | 'error'
  current: number
  total: number
  message?: string
  trigger: SyncTrigger
}

/**
 * One tracked player, as the finder lists them.
 *
 * The account is the same shape every other screen is handed, rather than a
 * flattened copy of its fields — there is one answer to what `isMine` means and
 * one row component that can draw either.
 *
 * Solo queue only. A list is scanned rather than studied, and a second ladder
 * per row buys nothing a profile does not already say better.
 */
export interface PlayerSearchResult {
  account: Account
  /** Null for an account that has never been placed, or never synced. */
  soloEntry: LeagueEntry | null
}

export interface RiotIdInput {
  gameName: string
  tagLine: string
}

export interface AssetManifest {
  version: string
  cdn: string
  championById: Record<number, { id: string; name: string }>
  spellById: Record<number, { id: string; name: string }>
  runeById: Record<number, { icon: string; name: string }>
}

/** Everything the dashboard header needs, in one answer. */
export interface DashboardData {
  account: Account
  leagueEntries: LeagueEntry[]
  syncState: SyncState | null
}

/** Riot's lifetime mastery beside win rates computed from synced games. */
export interface MasteryData {
  riotMastery: MasteryEntry[]
  localWinRates: ChampionStats[]
}
