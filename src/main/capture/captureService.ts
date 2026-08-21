import { BrowserWindow } from 'electron'
import { mkdirSync, statSync } from 'node:fs'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { setAppIconCapture } from '../appIcon'
import { createLogger } from '../telemetry/logger'
import { isNotRunning, liveClientGet } from '../liveClient/client'
import { getScoreboard } from '../services/liveClientService'
import { getCaptureSettings } from '../services/captureSettings'
import { bindPendingRecordings, broadcastRecordingsChanged } from '../services/recordingService'
import {
  createRecording,
  deleteRecording,
  finishRecording,
  insertRecordingEvents
} from '../db/repositories/recordings.repo'
import {
  getObsConnectionState,
  getObsLastError,
  isObsConnected,
  onObsConnectionChange,
  onObsRecordState,
  startObsClient
} from '../obs/client'
import {
  enterManagedMode,
  leaveManagedMode,
  startRecording,
  stopRecording
} from '../obs/provision'
import { setCurrentScene } from '../obs/config'
import { launchObs } from '../obs/launch'
import {
  INITIAL_STATE,
  needsGamePolling,
  reduce,
  type CaptureSessionState,
  type SessionEffect,
  type SessionEvent
} from './captureState'
import { selfNameSet, toRecordingEvents, type LiveEventDto } from './eventMapping'
import { recordSignalFor, resolveOutputPath } from './recordEvents'
import { containsGameStart, gameReadiness } from './gameClock'
import type { CaptureStatus, Scoreboard } from '@shared/types'

/**
 * Drives recording: watches for a game, tells OBS when to roll, and collects
 * the event stream that makes the footage seekable.
 *
 * All the decisions live in captureState.ts, eventMapping.ts and
 * matchBinding.ts, which are pure and tested. What is left here is the wiring —
 * loopback polling, OBS calls, DB writes and one broadcast — deliberately kept
 * as free of judgement as possible.
 */
const log = createLogger('capture')

/**
 * Fast enough that recording starts within a couple of seconds of the game
 * appearing, and free: this is loopback traffic against a port with no rate
 * limit. It only runs while a game is being followed — see needsGamePolling.
 */
const POLL_MS = 2_000

/** How long the game may stay unreachable mid-recording before we call it gone. */
const GAME_LOST_MS = 30_000

let state: CaptureSessionState = INITIAL_STATE
let timer: NodeJS.Timeout | null = null
let running = false

/** Set between asking OBS to record and OBS confirming it started. */
let awaitingStart: { accountId: number; queueId: number | null } | null = null

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

/** Logged once per game rather than every two seconds. */
let loggedAnswering = false

export function getCaptureStatus(): CaptureStatus {
  const settings = getCaptureSettings()
  if (!settings.enabled) return { state: 'off' }

  const connection = getObsConnectionState()
  if (connection === 'connecting') return { state: 'connecting' }
  if (connection === 'disconnected') {
    return { state: 'error', message: getObsLastError() ?? 'Not connected to OBS.' }
  }

  if (state.phase === 'recording' && state.recordingId !== null && state.startedAt !== null) {
    return { state: 'recording', recordingId: state.recordingId, startedAt: state.startedAt }
  }
  if (state.phase === 'armed') return { state: 'armed', queueId: state.queueId }
  return { state: 'idle' }
}

function broadcastStatus(): void {
  const status = getCaptureStatus()
  // Hung off the broadcast rather than off dispatch, which only fires when the
  // session phase moves. Turning capture off, and OBS coming and going, reach
  // the status by their own routes and matter to the badge just as much.
  setAppIconCapture(status)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.capture.status, status)
  }
}

/**
 * Feeds one event through the reducer and carries out whatever it asks for.
 *
 * Effects are run without awaiting so a slow OBS call cannot stall the poll
 * loop; each of them re-enters via dispatch when it finishes.
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
      awaitingStart = { accountId: effect.accountId, queueId: effect.queueId }
      try {
        await beginRecording()
      } catch (err) {
        awaitingStart = null
        log.debug('Could not start recording', { error: String(err) })
        dispatch({ type: 'aborted', reason: 'OBS would not start recording.' })
      }
      return
    }

    case 'endRecording': {
      try {
        // Kept rather than acted on: OBS also announces the stop as an event,
        // and finalising happens there so a stop the user pressed in OBS
        // themselves closes the row out the same way.
        stopReplyPath = await stopRecording()
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
        // broken recording. The file, if any, is left where OBS put it.
        const db = getDb()
        deleteRecording(db, effect.recordingId)
        broadcastRecordingsChanged()
      }
      await leaveManagedMode().catch(() => undefined)
      log.info('Capture abandoned', { reason: effect.reason })
      return
    }
  }
}

async function beginRecording(): Promise<void> {
  const settings = getCaptureSettings()
  if (settings.folder === null) throw new Error('No recording folder configured')

  // OBS refuses to record into a folder that does not exist, and the default is
  // a folder nobody has created yet.
  mkdirSync(settings.folder, { recursive: true })

  if (settings.mode === 'managed') {
    const ready = await enterManagedMode(settings.folder, settings.audio, settings.quality)
    if (!ready) throw new Error('Managed OBS setup failed')
  } else if (settings.obsScene) {
    // A user-configured scene is switched to but never edited — its sources,
    // audio and output settings are theirs. validateObs is what tells them if
    // any of that would stop the recording being playable.
    await setCurrentScene(settings.obsScene)
  }

  await startRecording()
}

/**
 * Called when OBS confirms frames are being written.
 *
 * The game clock is read here rather than when the request was sent, because
 * this is the instant the first frame exists and everything on the timeline is
 * measured from it.
 */
async function onRecordingStarted(): Promise<void> {
  const pending = awaitingStart
  awaitingStart = null
  if (!pending) return

  const board = await readScoreboard(pending.accountId)
  gameTimeOffset = board?.gameTime ?? 0
  selfNames = selfNameSet(
    board?.players
      .filter((player) => player.isSelf)
      .flatMap((player) => [player.gameName, `${player.gameName}#${player.tagLine}`]) ?? []
  )

  const settings = getCaptureSettings()
  const recordingId = createRecording(getDb(), {
    accountId: pending.accountId,
    // A placeholder: OBS names the file and only reports the name on stop.
    filePath: `${settings.folder}\\pending-${Date.now()}`,
    queueId: pending.queueId,
    startedAt: Date.now(),
    gameTimeOffset,
    selfChampionId: board?.players.find((player) => player.isSelf)?.championId ?? null,
    roster: board?.players.map((player) => player.championId ?? -1) ?? []
  })

  log.info('Recording started', { recordingId, gameTimeOffset })
  dispatch({ type: 'recordingStarted', recordingId, at: Date.now() })
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

  finishRecording(db, recordingId, endedAt, path ?? `unknown-${recordingId}`, bytes)
  log.info('Recording finished', { recordingId, path, bytes })

  void leaveManagedMode().catch(() => undefined)
  dispatch({ type: 'recordingStopped', at: endedAt })
  broadcastRecordingsChanged()

  // The match will not exist for minutes yet; postGameSync's retries are what
  // eventually make this succeed. Trying once now costs one query and catches
  // the case where the match was already synced. Never allowed to give up: a
  // recording that stopped a second ago has had no chance to be found yet.
  if (accountId !== null) bindPendingRecordings(accountId)
}

async function readScoreboard(accountId: number): Promise<Scoreboard | null> {
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

  if (state.phase === 'armed' && state.accountId !== null) {
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
      sawGameStart: await sawGameStart(),
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
    const board = await readScoreboard(state.accountId ?? 0)
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
  timer = setTimeout(() => {
    timer = null
    void tick().finally(scheduleNextPoll)
  }, POLL_MS)
}

/**
 * The League client's view of things, called from the LCU watcher.
 *
 * The watcher polls every ten seconds, which is far too slow to time a
 * recording by — but arming does not need to be quick. It only has to happen
 * before the loading screen ends, and that takes at least a minute.
 */
export function onGamePhase(accountId: number, queueId: number | null, playing: boolean): void {
  if (!running) return
  if (playing) {
    const wasIdle = state.phase === 'idle'
    dispatch({ type: 'gameStarted', accountId, queueId, at: Date.now() })
    if (wasIdle && state.phase === 'armed') {
      // Forgotten between games, or the previous game's final reading would
      // look like an advance against the next game's first one.
      lastGameTime = null
      answeringSince = null
      loggedAnswering = false
      gameLastSeen = Date.now()
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
  // off costs nothing.
  onObsConnectionChange(() => {
    broadcastStatus()
    // Losing OBS mid-recording means the footage stops here. The row is dropped
    // rather than left pointing at a file that may not even have a moov atom.
    if (!isObsConnected() && state.phase === 'recording') {
      dispatch({ type: 'aborted', reason: 'OBS disconnected during the game.' })
    }
  })

  onObsRecordState((event) => {
    // OBS reports a start and a stop in two steps each, and only the second
    // carries the filename — see recordEvents.ts. Acting on outputActive alone
    // closed the recording out on the STOPPING event, with nothing to point at.
    const signal = recordSignalFor(event)
    if (signal === 'started') {
      void onRecordingStarted()
      return
    }
    // 'finished' also fires when the user presses Stop in OBS themselves, which
    // is a reasonable thing to do and should still close the row out.
    if (signal === 'finished' && state.recordingId !== null) {
      finalizeRecording(state.recordingId, event.path)
    }
  })

  const settings = getCaptureSettings()
  if (settings.enabled) {
    // Started with the app rather than with a game: OBS takes seconds to come up
    // and accept a connection, and a loading screen does not wait. Not awaited —
    // the websocket client retries on its own, so nothing needs to block on it.
    void launchObs(settings.obsInstallPath, settings.obsHost, settings.obsPort)
    startObsClient()
  }

  broadcastStatus()
}

/** Re-reads settings after the user changes them — enabling needs OBS started. */
export function refreshCapture(): void {
  const settings = getCaptureSettings()
  if (settings.enabled && running) {
    void launchObs(settings.obsInstallPath, settings.obsHost, settings.obsPort)
    startObsClient()
  }
  broadcastStatus()
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
