import type { Position } from './positions'
import type { CaptureQuality } from './captureQuality'

export type { CaptureQuality } from './captureQuality'

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
  /**
   * The recording of this game, when one exists.
   *
   * Read only to decide whether the row's context menu can offer to watch it,
   * so it is a bare id rather than the whole replay.
   */
  replayId: number | null
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
 * whose bounds come from shared/seasons.ts. They share one union because the
 * Rank screen offers them from a single control — see views/RankHistory.tsx.
 */
export type RankRange = '7d' | '30d' | 'all' | `season:${number}`

/**
 * Whether the League client is reachable and whose account is logged into it.
 *
 * 'untracked' is its own state rather than an error: the client is running fine,
 * it is just signed in as somebody this app does not follow, and the only
 * sensible response is to offer to add them.
 */
export type LcuStatus =
  | { state: 'disconnected' }
  | {
      state: 'connected'
      accountId: number
      gameName: string
      tagLine: string
      /**
       * Whether a game is actually being played right now.
       *
       * The client's own playing phase, so it goes true at the loading screen —
       * before the game answers on loopback and well before there is a
       * scoreboard to show. That is the honest answer to "is a game on".
       */
      inGame: boolean
    }
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

/**
 * One row of the in-game scoreboard, built from the Live Client Data API the
 * running game serves on loopback.
 *
 * Richer than anything the spectator endpoint could offer — it is the game's
 * own view of itself — but it carries no puuid, so a player is identified by
 * their Riot ID and nothing else.
 */
export interface ScoreboardPlayer {
  /** Index in the game's own player array. The React key, since two players can share a name. */
  slot: number
  gameName: string | null
  tagLine: string | null
  /** The account this window is showing, so the row can be picked out of the ten. */
  isSelf: boolean
  isBot: boolean
  isDead: boolean
  /** Seconds until respawn; 0 whenever alive. */
  respawnTimer: number
  level: number | null
  position: Position | null
  teamId: number
  championId: number | null
  /** The name the game sent, so a champion the manifest has not caught up with still reads. */
  championName: string | null
  spell1Id: number | null
  spell2Id: number | null
  keystoneId: number | null
  secondaryTreeId: number | null
  /** Seven slots, index 6 the trinket — the shape itemSlots() takes. */
  items: number[]
  /** Granted by the lane rather than bought, exactly as on a stored match. */
  roleBoundItem: number
  kills: number
  deaths: number
  assists: number
  creepScore: number
  wardScore: number
}

export interface Scoreboard {
  gameMode: string
  mapName: string
  /** Seconds elapsed. */
  gameTime: number
  players: ScoreboardPlayer[]
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

/**
 * Which kind of Riot key is saved. It decides how fast the app is allowed to
 * ask for things, and whether it should keep warning about a 24-hour expiry —
 * an application key does not have one.
 */
export type RiotKeyType = 'personal' | 'application'

/**
 * The allowance of an approved application key, in Riot's own units. Editable
 * because Riot grants these per product rather than handing every approved key
 * the same pair of numbers.
 */
export interface RiotKeyLimits {
  /** Requests per 10 seconds. */
  burstLimit: number
  /** Requests per 10 minutes. */
  sustainedLimit: number
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
  keyType: RiotKeyType
  /** Ignored while `keyType` is personal, whose limits are Riot's fixed ones. */
  applicationLimits: RiotKeyLimits
}

export type ApiKeyStatus = 'valid' | 'missing' | 'expired' | 'invalid'

/**
 * What happened when an account was re-resolved from its Riot ID after the API
 * key changed. Riot encrypts puuids per key, so a new key invalidates every one
 * the app has stored and each account has to be introduced again.
 */
export type IdentityOutcome =
  /** The stored puuid is the one this key resolves to. Nothing to do. */
  | 'unchanged'
  /** A new puuid, and the account's history has been moved onto it. */
  | 'repaired'
  /** Riot no longer knows this Riot ID — almost always a rename. */
  | 'unresolved'
  /** Riot could not be asked at all. */
  | 'failed'

export interface IdentityReport {
  accountId: number
  /** `gameName#tagLine`, so a message about it can name the account. */
  riotId: string
  outcome: IdentityOutcome
}

export interface AssetManifest {
  version: string
  cdn: string
  championById: Record<number, { id: string; name: string }>
  spellById: Record<number, { id: string; name: string }>
  runeById: Record<number, { icon: string; name: string }>
}

/**
 * Which audio OBS is told to record.
 *
 * Only honoured in managed mode. A scene the user built is theirs, and muting
 * inputs inside it would leave their microphone muted if we crashed between
 * setting and restoring — so in manual mode this is reported rather than applied.
 */
export type CaptureAudio = 'none' | 'game' | 'game+mic'

/**
 * Whether the app owns the OBS scene it records with, or validates one the user
 * built themselves.
 *
 * Managed keeps every setting we care about — container, output folder, audio —
 * inside a profile and scene collection nothing else touches. Manual exists for
 * people who already stream and whose OBS is configured the way they want it.
 */
export type ObsMode = 'managed' | 'manual'

export interface CaptureSettings {
  enabled: boolean
  mode: ObsMode
  /** Where recordings are written. Capture cannot arm without one. */
  folder: string | null
  /** Queue ids that record. */
  queues: number[]
  /** Whether a queue outside CAPTURE_QUEUE_OPTIONS records too — customs, rotating modes. */
  otherQueues: boolean
  audio: CaptureAudio
  /**
   * What managed mode records at. Ignored in manual mode, where the user's own
   * OBS profile decides — see CaptureQuality.
   */
  quality: CaptureQuality
  /** Advisory ceiling in bytes. Nothing is ever deleted to honour it; 0 means no cap. */
  softCapBytes: number
  obsHost: string
  obsPort: number
  /** The password itself never crosses IPC, exactly as the Riot key never does. */
  hasObsPassword: boolean
  obsInstallPath: string | null
  /** Manual mode only: the scene to switch to before recording. */
  obsScene: string | null
}

/**
 * What capture is doing right now, broadcast to every window on change.
 *
 * 'armed' is its own state rather than folded into 'idle': between the client
 * reporting a game and the game itself answering on loopback there is a loading
 * screen lasting minutes, and "we know about your game and are waiting for it"
 * is a different thing to say than "nothing is happening".
 */
export type CaptureStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  | { state: 'idle' }
  | { state: 'armed'; queueId: number | null }
  | { state: 'recording'; replayId: number; startedAt: number }
  | { state: 'error'; message: string }

/** One reason a user-configured OBS cannot be recorded from as it stands. */
export type ObsProblem =
  | { kind: 'notConnected' }
  | { kind: 'noFolder' }
  /** MKV is OBS's default and Electron's <video> cannot play it at all. */
  | { kind: 'recordFormat'; found: string }
  | { kind: 'sceneNotChosen' }
  | { kind: 'sceneMissing'; scene: string }
  | { kind: 'noCaptureSource'; scene: string }
  | { kind: 'recordDirectory'; found: string; expected: string }

export interface ObsAudioInput {
  name: string
  muted: boolean
}

export interface ObsValidation {
  ok: boolean
  problems: ObsProblem[]
  /** Scenes offered in the picker, so manual mode does not need a typed name. */
  scenes: string[]
  /** What the chosen scene will actually record. Reported, never changed. */
  audioInputs: ObsAudioInput[]
}

/**
 * Whether a recording has found its match yet.
 *
 * 'unmatched' is a resting state, not a failure: a Practice Tool game produces
 * no match-v5 match at all and never will, and the footage is still worth
 * keeping. Nothing is deleted for failing to bind.
 */
export type ReplayBindState = 'pending' | 'bound' | 'unmatched'

/** The match a bound replay belongs to, denormalised so a list renders in one query. */
export interface ReplayMatchInfo {
  matchId: string
  gameCreation: number
  gameDuration: number
  gameMode: string | null
  queueId: number | null
  win: boolean
  championId: number
  championName: string | null
  kills: number
  deaths: number
  assists: number
}

export interface Replay {
  id: number
  accountId: number
  matchId: string | null
  bindState: ReplayBindState
  fileBytes: number | null
  /**
   * False once the file has gone missing behind our back — moved, or deleted
   * from Explorer. The row is kept so the disappearance is visible rather than
   * the replay silently vanishing from the list.
   */
  fileExists: boolean
  queueId: number | null
  /** Epoch milliseconds, the same units as MatchSummary.gameCreation. */
  startedAt: number
  endedAt: number | null
  durationSeconds: number | null
  selfChampionId: number | null
  match: ReplayMatchInfo | null
}

/** Which side of an event the tracked player was on. */
export type ReplayEventRole = 'kill' | 'death' | 'assist' | 'multikill'

export interface ReplayEvent {
  /** The game's own EventID, which is stable within a game and makes the poll idempotent. */
  eventId: number
  name: string
  /** Seconds on the game clock, as the game reported it. */
  gameTime: number
  /** Seconds into the video file — gameTime minus the offset captured at record start. */
  videoTime: number
  role: ReplayEventRole
  /** The other player for a kill or death, the streak size for a multikill. */
  label: string | null
}

/** Everything a replay window needs, fetched once when it opens. */
export interface ReplayDetail {
  replay: Replay
  events: ReplayEvent[]
}

export interface ReplayDiskUsage {
  totalBytes: number
  count: number
  unmatchedCount: number
  missingCount: number
  /** Mirrored from settings so the warning can be drawn without a second query. */
  softCapBytes: number
}
