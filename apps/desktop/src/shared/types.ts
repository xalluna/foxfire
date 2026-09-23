import type { Position, RecordingEvent, YouTubePrivacy } from '@foxfire/core'
import type { CaptureQuality } from './captureQuality'

export type { CaptureQuality } from './captureQuality'

/**
 * The League and server shapes both clients read, which live in @foxfire/core.
 *
 * Re-exported rather than imported from there everywhere, so the hundred-odd
 * places in this app that read them from @shared/types go on doing so. What is
 * declared below this is the desktop's alone: the League client, the live
 * game, OBS, recordings and replays on this disk, and which servers this
 * install has joined.
 */
export type {
  QueueType,
  Account,
  LeagueEntry,
  SharedReplaySummary,
  LocalArtefacts,
  MatchSummary,
  MatchRankInfo,
  RankSnapshot,
  SnapshotSource,
  ManualRank,
  EditableMatch,
  ManualRankEdit,
  RankMilestone,
  RankHistory,
  Season,
  SeasonInput,
  RankRange,
  MatchParticipant,
  MatchDetail,
  MasteryEntry,
  ChampionStats,
  SyncState,
  SyncTrigger,
  SyncProgressEvent,
  PlayerSearchResult,
  RiotIdInput,
  AssetManifest,
  DashboardData,
  MasteryData,
  ServerProbe,
  VersionInfo,
  SessionUser,
  ServerStorageUsage,
  AdminReplay,
  ImportProgress,
  ImportResult,
  ServerCredentials,
  ServerRegistration,
  InvitePreview,
  AdminUser,
  AdminUserPatch,
  AdminInvite,
  AdminPasswordReset,
  ServerAdminSettings,
  AdminActionResult,
  PasswordChange,
  EmailChange,
  YouTubePrivacy,
  MatchRecording,
  MatchRecordingSummary,
  AttachRecordingInput,
  AttachRecordingOutcome
} from '@foxfire/core'

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
      accountId: string
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
  accountId: string
  /** `gameName#tagLine`, so a message about it can name the account. */
  riotId: string
  outcome: IdentityOutcome
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
  | { state: 'recording'; recordingId: number; startedAt: number }
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
export type RecordingBindState = 'pending' | 'bound' | 'unmatched'

/**
 * The match an artifact — a recording or a Riot replay — belongs to,
 * denormalised so a list renders in one query.
 */
export interface LinkedMatchInfo {
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

export interface Recording {
  /** This machine's own row id. Recordings never leave the disk they are on. */
  id: number

  /** Whose account it was recorded on, as whichever store owns accounts spells it. */
  accountId: string
  matchId: string | null
  bindState: RecordingBindState
  fileBytes: number | null
  /**
   * False once the file has gone missing behind our back — moved, or deleted
   * from Explorer. The row is kept so the disappearance is visible rather than
   * the recording silently vanishing from the list.
   */
  fileExists: boolean
  queueId: number | null
  /** Epoch milliseconds, the same units as MatchSummary.gameCreation. */
  startedAt: number
  endedAt: number | null
  durationSeconds: number | null
  selfChampionId: number | null
  match: LinkedMatchInfo | null

  /**
   * The file was deleted on purpose, and the row kept because the recording
   * is on YouTube. Distinct from `fileExists`, which also turns false for a
   * file that went missing behind the app's back.
   */
  fileDeleted: boolean
  /** The copy on YouTube, once there is one. */
  youtube: RecordingYouTube | null
  /** An upload of this recording, queued, running, or finished. */
  upload: RecordingUpload | null
  /** Whether the active server has been told about the video. Null in local-only mode. */
  attachment: RecordingAttachment | null
}

/**
 * The events a recording carries. Defined in @foxfire/core now that they
 * travel to a server with the video; re-exported so the desktop's imports stay put.
 */
export type { RecordingEvent, RecordingEventRole } from '@foxfire/core'

/** A recording's copy on YouTube. */
export interface RecordingYouTube {
  videoId: string
  /** As YouTube reported it, which is not always what was asked for. */
  privacy: YouTubePrivacy | null
  /** Asked for public or unlisted and given private: the Google project has not been audited yet. */
  forcedPrivate: boolean
  source: 'upload' | 'link'
  title: string | null
  /** Epoch milliseconds. */
  at: number
}

export type UploadState =
  | 'queued'
  | 'uploading'
  | 'paused'
  | 'waiting_quota'
  | 'waiting_auth'
  | 'failed'
  | 'done'
  | 'cancelled'

/** An upload, as the Recordings tab draws it. */
export interface RecordingUpload {
  state: UploadState
  trigger: 'manual' | 'auto'
  bytesSent: number
  fileBytes: number | null
  /** Why it stopped, or what it is waiting for, in words. */
  error: string | null
  /** When the queue will try again, epoch milliseconds, when it is waiting on something. */
  resumesAt: number | null
}

export type AttachmentState = 'attached' | 'conflict' | 'not_owner' | 'failed'

export interface RecordingAttachment {
  state: AttachmentState
  message: string | null
}

/** What the upload form opens with, from the templates in settings. */
export interface UploadDraft {
  recordingId: number
  title: string
  description: string
  privacy: YouTubePrivacy
  durationSeconds: number | null
}

/** What the upload form sends back. */
export interface UploadRequest {
  recordingId: number
  title: string
  description: string
  privacy: YouTubePrivacy
}

/** Foxfire's Google connection on this machine, and the queue behind it. */
export interface YouTubeState {
  /**
   * Whether this build carries Foxfire's Google client at all. A build made
   * without it — a contributor's, or CI's — has no uploads, and says so rather
   * than offering a button that cannot work.
   */
  configured: boolean
  /** The Google account uploads go to, once connected. */
  email: string | null
  /** A sign-in is open in the browser, waiting for Google to hand it back. */
  connecting: boolean
  /** Why the last connect failed, or why the connection was dropped. */
  error: string | null
  /** The queue is holding because a game is on. */
  pausedForGame: boolean
  /** YouTube's daily upload quota is spent until this time, epoch milliseconds. */
  quotaResumesAt: number | null
}

export interface YouTubeSettings {
  /** Put every new recording on YouTube once it finds its match. Off unless somebody turns it on. */
  autoUpload: boolean
  defaultPrivacy: YouTubePrivacy
  titleTemplate: string
}

/** Everything a recording window needs, fetched once when it opens. */
export interface RecordingDetail {
  recording: Recording
  events: RecordingEvent[]
}

export interface RecordingDiskUsage {
  totalBytes: number
  count: number
  unmatchedCount: number
  missingCount: number
  /** Mirrored from settings so the warning can be drawn without a second query. */
  softCapBytes: number
}

/**
 * One of Riot's own replays: a .rofl file, played back by the League client.
 *
 * Deliberately without a bind state, unlike a recording. Riot names the file
 * after the game it came from, so `matchId` is known the moment the file
 * appears and `match` simply fills in later, by itself, once that game syncs.
 */
export interface Replay {
  /** This machine's own row id. A .rofl lives on one disk. */
  id: number

  /** Resolved from the match's participants. Null until the match is known. */
  accountId: string | null
  matchId: string | null
  /**
   * False once Foxfire's copy has gone missing behind our back. The row is kept
   * so the disappearance is visible rather than the replay quietly vanishing.
   */
  fileExists: boolean
  fileBytes: number | null
  /** e.g. "15.16.700.1234". Null when the .rofl header could not be read. */
  gameVersion: string | null
  /** major.minor, the key that finds a client able to play this file. */
  patch: string | null
  durationSeconds: number | null
  /** Epoch milliseconds, the same units as MatchSummary.gameCreation. */
  recordedAt: number
  match: LinkedMatchInfo | null
  /**
   * Why this replay cannot be watched right now, or null when it can — most
   * often that no installed client still plays its patch. Stated rather than
   * hidden, exactly as the match menu states its own reasons.
   */
  blockedReason: string | null
}

export interface ReplayDiskUsage {
  totalBytes: number
  count: number
  /** Replays whose match has not synced, so the row cannot say what game it was. */
  unlinkedCount: number
  missingCount: number
  /** Replays whose patch no installed client can play. */
  unplayableCount: number
  /** Mirrored from settings so the warning can be drawn without a second query. */
  softCapBytes: number
}

/** Where a patch's game version came from, so a hand-typed one is not overwritten. */
export type ArchivePatchSource = 'detected' | 'manual'

/** A League install kept around to play replays from an older patch. */
export interface ClientArchive {
  id: number
  path: string
  /** major.minor, e.g. "15.14". */
  patch: string
  patchSource: ArchivePatchSource
  label: string | null
  /** False once the folder has gone missing, so a dead entry is visible rather than silent. */
  pathExists: boolean
}

/** The live install, which is never stored: it is always there and its patch moves. */
export interface LiveClient {
  path: string | null
  /** major.minor, read from the game executable. Null when it could not be read. */
  patch: string | null
}

export interface RoflSettings {
  enabled: boolean
  /**
   * Where Riot writes replays. Null means "use whatever the client reports",
   * which is the normal case — the folder is configurable inside League.
   */
  sourceFolder: string | null
  /** What sourceFolder actually resolved to, after asking the client. */
  resolvedSourceFolder: string | null
  /**
   * Whether the League client is set to keep replays. Foxfire can only ingest
   * files the client actually wrote, so this being off is the one thing that
   * makes the whole feature silently do nothing. Null when the client was not
   * running to ask.
   */
  autoRecordEnabled: boolean | null
  /** Where Foxfire keeps its own copies. A subfolder of the recordings folder. */
  folder: string | null
  /** Advisory ceiling in bytes. Nothing is deleted to honour it; 0 means no cap. */
  softCapBytes: number
}

/** Progress of the folder import, broadcast so the tab can say what is happening. */
export interface ReplayImportProgress {
  current: number
  total: number
  done: boolean
}

/** Progress of an install copy, broadcast so the archive window can draw a bar. */
export interface ArchiveCopyProgress {
  copiedBytes: number
  totalBytes: number
  /** Relative to the install root, so the path stays readable. Null when finished. */
  currentFile: string | null
  done: boolean
  cancelled: boolean
}

/**
 * What came of asking the League client to open a replay.
 *
 * A failure carries the command that was attempted so an archived client that
 * refuses to start leaves the user something to act on rather than a button
 * that appears to do nothing.
 */
export interface ReplayLaunchResult {
  ok: boolean
  reason?: string
  attemptedCommand?: string | null
}

/** The result of adding or copying a client archive. */
export interface ArchiveResult {
  ok: boolean
  error?: string
  archive?: ClientArchive
}

/* -------------------------------------------------------------------------- */
/* Foxfire Server                                                             */
/* -------------------------------------------------------------------------- */

/** Who you are on a server. */
export interface ServerSession {
  url: string
  username: string
  email: string
  isAdmin: boolean
}

/** A server this desktop has joined, whether or not it is the active one. */
export interface KnownServer {
  url: string
  /** The server's own name, or its host until it has told us one. */
  name: string
  /** The account signed in there. Null once the session has been signed out. */
  username: string | null
  isActive: boolean
}

/**
 * Which server is answering, and which ones this desktop remembers.
 *
 * `activeUrl` null is local-only mode — the app as it has always been, reading
 * this machine's own database with this machine's own Riot key. Server mode is
 * the alternative, one server at a time.
 */
export interface ServerState {
  activeUrl: string | null
  servers: KnownServer[]
  session: ServerSession | null
  /**
   * Where the active server's web client is reached from outside, which is
   * what "Copy link" builds on. Null in local-only mode, and from a server
   * older than the web client.
   */
  publicUrl: string | null
  /**
   * Set when the active server refused this build outright, and holds the
   * version to install. Everything server-backed is unavailable until then, so
   * this is the one thing the UI has to say.
   */
  upgradeRequired: string | null
  /**
   * The active server refused this build for being newer than anything it
   * knows. Nothing to install here: its host has to update the server.
   */
  serverOutdated: boolean

  /**
   * Whether Riot has refused the active server's API key.
   *
   * Its own flag rather than the local key's, because the two want different
   * sentences: one is yours to fix by pasting a new key, and this one is the
   * host's. Everything already stored still reads while it is true — what stops
   * is anything new arriving.
   */
  riotKeyRejected: boolean
}

/* -------------------------------------------------------------------------- */

/** What the updater is doing, if anything. */
export type UpdateStatus =
  /** Not a packaged build, so there is nothing to update. */
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'downloading'
  /** Downloaded and verified. Installs on restart, or on the next quit. */
  | 'ready'
  | 'error'

/** What is going on that a restart would interrupt. */
export type UpdateBlocker = 'game' | 'recording'

/**
 * Everything the window and the tray need to say about updates.
 *
 * One shape for both, pushed on every change, because the two have to agree:
 * an update offered in a banner while the tray menu still says the app is up
 * to date would be a bug nobody could explain.
 */
export interface UpdateState {
  status: UpdateStatus
  /** The build running now. */
  current: string
  /** What is being fetched, or waiting to install. Null when neither. */
  target: string | null
  /** How far the download has got, 0-100. Null when nothing is downloading. */
  percent: number | null
  /** The target version's changelog section, as written in CHANGELOG.md. */
  notes: string | null
  /**
   * Why restarting now would be a bad idea.
   *
   * A restart during a game loses the LP reading that game was played for, and
   * during a recording it loses the recording. The offer stays on screen and
   * the button is refused until whatever this names has finished.
   */
  blockedBy: UpdateBlocker | null
  /**
   * Set when a newer build exists and the active server will not take it.
   *
   * Not an error and not something this machine can fix: the server's allow
   * list is what decides which build may run against it, so the remedy is its
   * host updating the server. Said out loud so somebody knows to ask.
   */
  heldBy: { serverName: string; allows: string; newest: string } | null
  /** The last failure, cleared by the next check that gets through. */
  error: string | null
  /**
   * Set for the session that follows an update, and cleared once seen.
   *
   * The patch notes are the only account of what changed that reaches somebody
   * who does not read the repository, so they are shown once on arrival rather
   * than left for whoever thinks to open Settings.
   */
  justInstalled: { version: string; notes: string | null } | null
}

/**
 * The outcome of connecting, registering or signing in.
 *
 * Carries the whole new state rather than just a flag, so the settings page
 * never has to ask a second time for what changed.
 */
export interface ServerAuthResult {
  ok: boolean
  error: string | null
  state: ServerState
}
