import { mkdirSync, statSync } from 'node:fs'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { setAppIconCapture } from '../appIcon'
import { createLogger } from '../telemetry/logger'
import { isNotRunning, liveClientGet } from '../liveClient/client'
import { accountContext } from '../api/accountContext'
import type { Scoreboard } from '../liveClient/scoreboardMapping'
import { getScoreboard } from '../services/liveClientService'
import { getCaptureSettings } from '../services/captureSettings'
import { bindPendingRecordings, broadcastRecordingsChanged } from '../services/recordingService'
import {
  createRecording,
  deleteRecording,
  finishRecording,
  insertRecordingEvents
} from '../db/repositories/recordings.repo'
import { obsRecorder } from '../obs/obsRecorder'
import { nativeRecorder } from './native/nativeRecorder'
import type { Recorder, RecordTarget } from './recorder'
import {
  INITIAL_STATE,
  needsGamePolling,
  reduce,
  type CaptureSessionState,
  type SessionEffect,
  type SessionEvent
} from './captureState'
import { selfNameSet, toRecordingEvents, type LiveEventDto } from './eventMapping'
import { resolveOutputPath } from './recordEvents'
import { containsGameStart, gameReadiness, isTftReady } from './gameClock'
import { fileFinishedRecording } from './fileRecording'
import type { GameId } from '@foxfire/core'
import type { CaptureDriver, CaptureStatus } from '@shared/types'

/**
 * Drives recording: watches for a game, tells the recorder when to roll, and
 * collects the event stream that makes the footage seekable.
 *
 * All the decisions live in captureState.ts, eventMapping.ts and
 * matchBinding.ts, which are pure and tested. What is left here is the wiring —
 * loopback polling, recorder calls, DB writes and one broadcast — deliberately
 * kept as free of judgement as possible.
 *
 * Which recorder writes the video — OBS or the native one — is a setting, and
 * nothing here depends on the answer: see recorder.ts.
 */
const log = createLogger('capture')

/**
 * The pace of everything read from the game while it is followed — the
 * scoreboard, the event feed for the markers. It only runs while a game is
 * being followed — see needsGamePolling.
 */
const POLL_MS = 2_000

/**
 * The pace of looking for the game to start, while it loads.
 *
 * At POLL_MS, a game was noticed anything up to two seconds after it began, and
 * the recording started that late — measured at 0.5 to 1.5 seconds into three
 * real games, before the recorder had even started. Only the game's own event
 * feed is read this often: loopback, no rate limit, nothing on a server.
 */
const ARMED_POLL_MS = 250

/** How long the game may stay unreachable mid-recording before we call it gone. */
const GAME_LOST_MS = 30_000

let state: CaptureSessionState = INITIAL_STATE
let timer: NodeJS.Timeout | null = null
let running = false

const RECORDERS: readonly Recorder[] = [obsRecorder, nativeRecorder]

function recorderFor(driver: CaptureDriver): Recorder {
  return driver === 'native' ? nativeRecorder : obsRecorder
}

/**
 * The recorder that was asked to roll, from the ask until the file is filed.
 *
 * Held rather than re-read from the setting, so switching recorder in settings
 * mid-game cannot strand the recording: its stop and its file still come from
 * the recorder that started it, and the switch takes effect after.
 */
let recording: Recorder | null = null

/**
 * The recorder made ready while the game loads, until begin takes it over or
 * the game never starts — see Recorder.prepare.
 */
let prepared: Recorder | null = null

/** The recorder whose state the status shows: the one recording, or the one chosen. */
function activeRecorder(): Recorder {
  return recording ?? recorderFor(getCaptureSettings().driver)
}

/** Set between asking the recorder to record and it confirming it started. */
let awaitingStart: { accountId: string; queueId: number | null; game: GameId; gameId: number | null } | null = null

/** Last moment the game answered on loopback, so a crash can be told from a stall. */
let gameLastSeen = 0

/**
 * The filename StopRecord replied with, held until the matching event arrives.
 *
 * Both sources are kept because either can be absent: the reply is lost if the
 * request throws, and the event only carries a path on the final stop.
 */
let stopReplyPath: string | null = null

/** Names the event feed might use for the tracked player, resolved once per game. */
let selfNames: ReadonlySet<string> = new Set()

/** The game clock at the first recorded frame — every event is measured from it. */
let gameTimeOffset = 0

/**
 * The previous game-clock reading, so a loaded game can be told from a loading
 * one. The API answers all through the loading screen with the clock stopped.
 */
let lastGameTime: number | null = null

/** When the game first answered on loopback, for the readiness backstop. */
let answeringSince: number | null = null

/**
 * When the scoreboard was last read while armed. The board is read at the
 * ordinary pace even while the game start is looked for four times as often —
 * connected to a server, every read asks the server whose account it is.
 */
let lastArmedBoardAt = 0

/** Logged once per game rather than every two seconds. */
let loggedAnswering = false

export function getCaptureStatus(): CaptureStatus {
  const settings = getCaptureSettings()
  if (!settings.enabled) return { state: 'off' }

  const connection = activeRecorder().connection()
  if (connection.state === 'connecting') return { state: 'connecting' }
  if (connection.state === 'unavailable') return { state: 'error', message: connection.message }

  if (state.phase === 'recording' && state.recordingId !== null && state.startedAt !== null) {
    return { state: 'recording', recordingId: state.recordingId, startedAt: state.startedAt }
  }
  if (state.phase === 'armed') return { state: 'armed', queueId: state.queueId }
  return { state: 'idle' }
}

function broadcastStatus(): void {
  const status = getCaptureStatus()
  // Hung off the broadcast rather than off dispatch, which only fires when the
  // session phase moves. Turning capture off, and the recorder coming and going,
  // reach the status by their own routes and matter to the badge just as much.
  setAppIconCapture(status)
  broadcast(CH.capture.status, status)
}

/**
 * Feeds one event through the reducer and carries out whatever it asks for.
 *
 * Effects are run without awaiting so a slow recorder call cannot stall the
 * poll loop; each of them re-enters via dispatch when it finishes.
 */
function dispatch(event: SessionEvent): void {
  const settings = getCaptureSettings()
  const { state: next, effect } = reduce(state, event, {
    enabled: settings.enabled,
    hasFolder: settings.folder !== null,
    queues: settings.queues,
    otherQueues: settings.otherQueues
  })

  const changed = next.phase !== state.phase
  state = next
  // A game that was prepared for and never started — a dodge, a crash in
  // loading — leaves nothing for begin to take over, so the preparation is
  // undone here: OBS goes back to the user's own profile, the audio closes.
  if (changed && state.phase === 'idle' && prepared && recording === null) {
    void prepared.release()
    prepared = null
  }
  if (changed) {
    log.debug('Capture phase changed', { phase: state.phase, event: event.type })
    broadcastStatus()
    scheduleNextPoll()
  }

  void runEffect(effect)
}

async function runEffect(effect: SessionEffect): Promise<void> {
  switch (effect.type) {
    case 'none':
      return

    case 'beginRecording': {
      if (awaitingStart) return
      awaitingStart = {
        accountId: effect.accountId,
        queueId: effect.queueId,
        game: effect.game,
        gameId: effect.gameId
      }
      try {
        await beginRecording(effect.game)
      } catch (err) {
        awaitingStart = null
        log.debug('Could not start recording', { error: String(err) })
        dispatch({ type: 'aborted', reason: 'The recorder would not start recording.' })
      }
      return
    }

    case 'endRecording': {
      try {
        // Kept rather than acted on: the recorder also announces the stop as a
        // signal, and finalising happens there so a stop the user pressed in OBS
        // themselves closes the row out the same way.
        stopReplyPath = (await recording?.end()) ?? null
      } catch (err) {
        log.debug('Could not stop recording cleanly', { error: String(err) })
        // No stop event is coming, so close the row out here on what is known.
        finalizeRecording(effect.recordingId, null)
      }
      return
    }

    case 'abandon': {
      if (effect.recordingId !== null) {
        // Nothing playable was produced, so the row would only ever render as a
        // broken recording. The file, if any, is left where the recorder put it.
        const db = getDb()
        deleteRecording(db, effect.recordingId)
        broadcastRecordingsChanged()
      }
      const abandoned = recording
      recording = null
      await abandoned?.release()
      settleRecorders()
      log.info('Capture abandoned', { reason: effect.reason })
      return
    }
  }
}

/** What to record a game of, and where, from the settings as they are now. */
function recordTarget(game: GameId): RecordTarget {
  const settings = getCaptureSettings()
  if (settings.folder === null) throw new Error('No recording folder configured')

  // Neither recorder will write into a folder that does not exist, and the
  // default is a folder nobody has created yet.
  mkdirSync(settings.folder, { recursive: true })

  return {
    game,
    folder: settings.folder,
    quality: settings.quality,
    audio: settings.audio,
    micDeviceId: settings.micDeviceId
  }
}

/**
 * Readies the chosen recorder while the game loads. Not awaited, and its
 * failure is nobody's concern: begin does whatever this did not.
 */
function prepareRecording(game: GameId): void {
  try {
    const target = recordTarget(game)
    prepared = recorderFor(getCaptureSettings().driver)
    void prepared.prepare(target)
  } catch (err) {
    log.debug('Could not prepare for the game', { error: String(err) })
  }
}

async function beginRecording(game: GameId): Promise<void> {
  const target = recordTarget(game)
  const chosen = recorderFor(getCaptureSettings().driver)
  // Switched in settings during the loading screen: the one prepared is let go.
  if (prepared && prepared !== chosen) void prepared.release()
  prepared = null

  recording = chosen
  await recording.begin(target)
}

/**
 * Called when the recorder confirms frames are being written.
 *
 * The game clock is read here rather than when the request was sent, because
 * this is the instant the first frame exists and everything on the timeline is
 * measured from it. A recorder that knows its file began earlier than it could
 * say so passes that moment as `fileStart`, and the clock is wound back to it.
 */
async function onRecordingStarted(fileStart: number = Date.now()): Promise<void> {
  const pending = awaitingStart
  awaitingStart = null
  if (!pending) return

  // A TFT game serves no scoreboard, clock or events: its recording keeps no
  // markers to offset, and its match is found by its id rather than a roster.
  const board = pending.game === 'tft' ? null : await readScoreboard(pending.accountId)
  const lateBySeconds = Math.max(0, (Date.now() - fileStart) / 1000)
  gameTimeOffset = board ? Math.max(0, board.gameTime - lateBySeconds) : 0
  selfNames = selfNameSet(
    board?.players
      .filter((player) => player.isSelf)
      .flatMap((player) => [player.gameName, `${player.gameName}#${player.tagLine}`]) ?? []
  )

  const settings = getCaptureSettings()
  // Resolved now rather than stored on the session: the Riot ID is what finds
  // this recording again after a move between servers, and it is cheapest to
  // ask for at the one moment the row is written.
  const account = await accountContext(pending.accountId)

  const recordingId = createRecording(getDb(), {
    accountId: account.accountId,
    riotId: account.riotId,
    serverKey: account.serverKey,
    // The file being written when the recorder names it up front, as the native
    // one does. Otherwise a placeholder: OBS names the file and only reports the
    // name on stop.
    filePath: recording?.outputPath() ?? `${settings.folder}\\pending-${Date.now()}`,
    queueId: pending.queueId,
    startedAt: fileStart,
    gameTimeOffset,
    selfChampionId: board?.players.find((player) => player.isSelf)?.championId ?? null,
    roster: board?.players.map((player) => player.championId ?? -1) ?? [],
    game: pending.game,
    gameId: pending.gameId,
    platformId: account.platformId ?? null
  })

  log.info('Recording started', { recordingId, game: pending.game, gameId: pending.gameId, gameTimeOffset })
  dispatch({ type: 'recordingStarted', recordingId, at: fileStart })
  broadcastRecordingsChanged()
}

function finalizeRecording(recordingId: number, eventPath: string | null): void {
  const db = getDb()
  // Read before the dispatch below, which resets the session to idle
  // synchronously and takes the account id with it.
  const accountId = state.accountId
  const endedAt = Date.now()
  const path = resolveOutputPath(eventPath, stopReplyPath)
  stopReplyPath = null

  let bytes: number | null = null
  if (path) {
    try {
      bytes = statSync(path).size
    } catch {
      // Written to a network drive, or already moved. The row is still worth
      // keeping; only the size reported in the disk total is lost.
    }
  }

  // Into its place under the folder — player, game, mode — now that the
  // recorder has closed it. See recordingLayout.ts.
  const filed = path
    ? fileFinishedRecording(db, recordingId, path, getCaptureSettings().folder, broadcastRecordingsChanged)
    : null

  finishRecording(db, recordingId, endedAt, filed ?? `unknown-${recordingId}`, bytes)
  log.info('Recording finished', { recordingId, path: filed, bytes })

  const finished = recording
  recording = null
  void finished?.release()
  // A recorder switched in settings during the game takes over now.
  settleRecorders()
  dispatch({ type: 'recordingStopped', at: endedAt })
  broadcastRecordingsChanged()

  // The match will not exist for minutes yet; postGameSync's retries are what
  // eventually make this succeed. Trying once now costs one query and catches
  // the case where the match was already synced. Never allowed to give up: a
  // recording that stopped a second ago has had no chance to be found yet.
  // Not awaited, and the rejection swallowed rather than left floating: the
  // recording is already written down, and the post-game retries are what
  // actually pair it. This is only the free attempt in case the match was
  // already there.
  if (accountId !== null) void bindPendingRecordings(accountId).catch(() => undefined)
}

/**
 * One tick of a TFT game, which only ever starts the recording.
 *
 * TFT's game serves nothing on loopback to read (see TFT_START_DELAY_MS), so it
 * records on time alone and stops when the League client says the game is
 * over — there is no clock whose silence could say it is gone sooner.
 */
function tickTft(now: number): void {
  // Nothing to decide while the recorder is starting: the game already has.
  if (state.phase !== 'armed' || awaitingStart) return
  const armedForMs = now - (state.armedAt ?? now)
  if (!isTftReady(armedForMs)) return
  log.info('TFT game is live; starting the recording', { armedForMs })
  dispatch({ type: 'gameReady', gameTime: 0, at: now })
}

async function readScoreboard(accountId: string): Promise<Scoreboard | null> {
  try {
    return await getScoreboard(accountId)
  } catch (err) {
    if (!isNotRunning(err)) log.debug('Scoreboard read failed', { error: String(err) })
    return null
  }
}

/**
 * Whether the game's own feed has announced that play began.
 *
 * The explicit signal, and the one that survives a payload with no usable game
 * clock. Failures are swallowed to false: this is one of two ways to notice a
 * game has started, and a feed that is briefly unavailable must not be able to
 * stop the other one working.
 */
async function sawGameStart(): Promise<boolean> {
  try {
    const raw = await liveClientGet<{ Events?: LiveEventDto[] }>('/liveclientdata/eventdata')
    return containsGameStart(raw.Events ?? [])
  } catch {
    return false
  }
}

async function pollEvents(recordingId: number): Promise<void> {
  try {
    const raw = await liveClientGet<{ Events?: LiveEventDto[] }>('/liveclientdata/eventdata')
    const events = toRecordingEvents(raw.Events ?? [], selfNames, gameTimeOffset)
    // Every poll returns the whole game, so this is an upsert by design — see
    // insertRecordingEvents. A crash costs one interval, not the timeline.
    insertRecordingEvents(getDb(), recordingId, events)
  } catch (err) {
    if (!isNotRunning(err)) log.debug('Event poll failed', { error: String(err) })
  }
}

async function tick(): Promise<void> {
  const now = Date.now()
  dispatch({ type: 'tick', at: now })

  if (state.game === 'tft') {
    tickTft(now)
    return
  }

  if (state.phase === 'armed' && state.accountId !== null) {
    // Nothing to look for while the recorder is starting: the game already has.
    if (awaitingStart) return

    // The game's own word that play has begun, looked for every quarter
    // second: loopback only, and the difference between a recording that
    // starts with the game and one that starts two seconds into it.
    const started = await sawGameStart()
    if (started) {
      log.info('Game is live; starting the recording', { via: 'event', gameTime: lastGameTime })
      dispatch({ type: 'gameReady', gameTime: lastGameTime ?? 0, at: now })
      return
    }

    // The rest at the ordinary pace — see lastArmedBoardAt.
    if (now - lastArmedBoardAt < POLL_MS) return
    lastArmedBoardAt = now

    // The 404 that lasts from champion select until the game process is up is
    // swallowed by isNotRunning, so this keeps returning null through most of
    // the wait. It starts answering during the loading screen though, with the
    // clock stopped — so an answer alone is not enough to record on.
    const board = await readScoreboard(state.accountId)
    if (!board) return

    gameLastSeen = now
    if (answeringSince === null) answeringSince = now
    if (!loggedAnswering) {
      // The one line that makes a game which never records diagnosable. Without
      // it, a readiness check that never passes looks identical to a game that
      // never happened.
      log.info('Game is answering; waiting for it to start', { gameTime: board.gameTime })
      loggedAnswering = true
    }

    const readiness = gameReadiness({
      previousGameTime: lastGameTime,
      gameTime: board.gameTime,
      // Looked for above, this tick.
      sawGameStart: false,
      answeringForMs: now - answeringSince
    })
    lastGameTime = board.gameTime

    if (readiness !== 'wait') {
      log.info('Game is live; starting the recording', {
        via: readiness,
        gameTime: board.gameTime
      })
      dispatch({ type: 'gameReady', gameTime: board.gameTime, at: now })
    }
    return
  }

  if (state.phase === 'recording' && state.recordingId !== null) {
    const board = await readScoreboard(state.accountId ?? '')
    if (board) {
      gameLastSeen = now
      await pollEvents(state.recordingId)
    } else if (now - gameLastSeen > GAME_LOST_MS) {
      // The client's end-of-game phase usually gets here first. This is the
      // other path: a crash or alt-F4, where the client never says the game
      // ended and the footage would otherwise record an empty desktop forever.
      log.info('Game stopped answering; closing the recording')
      dispatch({ type: 'gameGone', at: now })
    }
  }
}

function scheduleNextPoll(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!running || !needsGamePolling(state)) return
  timer = setTimeout(
    () => {
      timer = null
      void tick().finally(scheduleNextPoll)
    },
    state.phase === 'armed' ? ARMED_POLL_MS : POLL_MS
  )
}

/**
 * The League client's view of things, called from the LCU watcher.
 *
 * The watcher polls every ten seconds, which is far too slow to time a
 * recording by — but arming does not need to be quick. It only has to happen
 * before the loading screen ends, and that takes at least a minute.
 *
 * `session` is what the client's session said about the game: which game it
 * is, and Riot's id for it.
 */
export function onGamePhase(
  accountId: string,
  queueId: number | null,
  playing: boolean,
  session: { game: GameId; gameId: number | null } = { game: 'lol', gameId: null }
): void {
  if (!running) return
  if (playing) {
    const wasIdle = state.phase === 'idle'
    dispatch({ type: 'gameStarted', accountId, queueId, game: session.game, gameId: session.gameId, at: Date.now() })
    if (wasIdle && state.phase === 'armed') {
      // Forgotten between games, or the previous game's final reading would
      // look like an advance against the next game's first one.
      lastGameTime = null
      answeringSince = null
      loggedAnswering = false
      lastArmedBoardAt = 0
      gameLastSeen = Date.now()
      // The loading screen is the time to get the recorder ready.
      prepareRecording(session.game)
      scheduleNextPoll()
    }
  } else {
    dispatch({ type: 'gameEnded', at: Date.now() })
  }
}

export function initCapture(): void {
  if (running) return
  running = true

  // Subscribed before the enabled check, and so exactly once per process
  // whatever the setting says. The guard above makes this the only pass, and
  // refreshCapture has no way to subscribe later — so returning early with
  // capture off left the OBS record feed with nobody listening, and switching
  // capture on in settings gave a session that could never reach 'recording'
  // until the app was restarted. Both handlers no-op unless a session is under
  // way, which only the enabled path can produce, so listening while capture is
  // off costs nothing. Both recorders, for the same reason: the driver can be
  // switched at any time.
  for (const recorder of RECORDERS) {
    recorder.onConnectionChange(() => {
      if (!running) return
      broadcastStatus()
      // Losing the recorder mid-recording means the footage stops here. The row
      // is dropped rather than left pointing at a file that may not even have a
      // moov atom.
      if (
        recorder === recording &&
        recorder.connection().state !== 'ready' &&
        state.phase === 'recording'
      ) {
        dispatch({ type: 'aborted', reason: 'The recorder went away during the game.' })
      }
    })

    recorder.onSignal((signal) => {
      // Only the recorder that was asked to roll is listened to. The other may
      // be an OBS the user is recording something of their own with.
      if (!running || recorder !== recording) return
      if (signal.kind === 'started') {
        void onRecordingStarted(signal.at)
        return
      }
      if (signal.kind === 'failed') {
        awaitingStart = null
        dispatch({ type: 'aborted', reason: signal.reason })
        return
      }
      if (state.recordingId !== null) finalizeRecording(state.recordingId, signal.path)
    })
  }

  settleRecorders()
  broadcastStatus()
}

/**
 * Boots the chosen recorder, and lets go of the other once it is not recording.
 *
 * Booted with the app rather than with a game: OBS takes seconds to come up and
 * accept a connection, and the native recorder has its encoders to find — a
 * loading screen waits for neither. Repeating this is harmless; both recorders'
 * boot is a no-op when they are already up.
 */
function settleRecorders(): void {
  const settings = getCaptureSettings()
  if (!settings.enabled || !running) return

  const chosen = recorderFor(settings.driver)
  chosen.boot()
  for (const recorder of RECORDERS) {
    if (recorder !== chosen && recorder !== recording && recorder !== prepared) void recorder.shutdown()
  }
}

/** Re-reads settings after the user changes them — enabling needs a recorder started. */
export function refreshCapture(): void {
  settleRecorders()
  broadcastStatus()
}

/**
 * Lets go of both recorders as the app quits.
 *
 * A native recording in progress is written down as it stands first, at the
 * path FFmpeg is writing: ending it lets FFmpeg close the file on its own after
 * the app is gone, and the fragmented MP4 it writes plays whatever happens. It
 * is not filed into its folder — the file is still open, and the timer that
 * would retry the move does not outlive the process. An OBS recording is left
 * as it always was.
 *
 * Synchronous up to the shutdowns, because will-quit does not wait.
 */
export function shutdownCapture(): void {
  const live = recording
  const recordingId = state.recordingId
  const path = live?.outputPath() ?? null
  stopCapture()

  if (live && recordingId !== null && path !== null) {
    let bytes: number | null = null
    try {
      bytes = statSync(path).size
    } catch {
      // Not written to yet. The row still points at where it will be.
    }
    finishRecording(getDb(), recordingId, Date.now(), path, bytes)
    log.info('Recording closed by quit', { recordingId, path })
  }

  recording = null
  // Best effort: OBS may be gone before it hears it.
  if (prepared) void prepared.release()
  prepared = null
  for (const recorder of RECORDERS) void recorder.shutdown()
}

export function stopCapture(): void {
  running = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  state = INITIAL_STATE
  lastGameTime = null
  answeringSince = null
  loggedAnswering = false
}
