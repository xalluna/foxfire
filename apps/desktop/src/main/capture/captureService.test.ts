import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scoreboard, ScoreboardPlayer } from '@shared/types'
import type { RecordStateEvent } from './recordEvents'

/**
 * The wiring around the reducer, which captureState.test.ts cannot see.
 *
 * One thing is really being tested here: that OBS's record feed is listened to
 * for the whole life of the process. initCapture runs once and guards against a
 * second pass, so anything it skips on the disabled path it skips forever — and
 * it used to return before subscribing when capture was off. Switching capture
 * on in settings then gave a session where OBS's "recording started" reached
 * nobody, so a game armed, asked OBS to roll, and sat there until the app was
 * restarted. None of that is visible without playing a real game, which is why
 * it shipped.
 *
 * Everything the service reaches for is stubbed except the pure modules it
 * decides with — captureState, gameClock, recordEvents, eventMapping — which
 * run for real, so the path through them is the one that ships.
 */

const T0 = 1_700_000_000_000
const ACCOUNT = 1
const QUEUE = 420
const RECORDING_ID = 7

/** captureService's own poll interval, so a tick can be advanced onto. */
const POLL_MS = 2_000

type ConnectionListener = (state: string, error: string | null) => void
type RecordListener = (event: RecordStateEvent) => void

const live = vi.hoisted(() => ({
  /** Whatever getCaptureSettings should answer with, rewritten mid-test. */
  settings: {} as Record<string, unknown>,
  connection: 'disconnected',
  /** What the service subscribed to OBS with — the point of the exercise. */
  connectionListeners: [] as ConnectionListener[],
  recordListeners: [] as RecordListener[],
  board: null as Scoreboard | null,
  /** The game's own event feed; a GameStart in here is what makes a game ready. */
  events: [] as Array<{ EventName: string }>,
  startObsCalls: 0,
  startRecordCalls: 0,
  createdRecordings: 0,
  finished: [] as Array<{ recordingId: number; path: string }>,
  deleted: [] as number[],
  /** Every capture status pushed at the renderer. */
  broadcasts: [] as unknown[],
  /** And at the taskbar badge, which broadcastStatus drives from the same call. */
  iconStatuses: [] as unknown[]
}))

vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} })
}))

// A window that only remembers what it was sent, so the other half of the bug —
// OBS connecting no longer re-rendering the status — can be asserted on.
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (_channel: string, status: unknown) => {
            live.broadcasts.push(status)
          }
        }
      }
    ]
  }
}))

// The taskbar badge draws with nativeImage and screen, neither of which exists
// behind the window stub above. What matters here is only that it is told.
vi.mock('../appIcon', () => ({
  setAppIconCapture: (status: unknown) => {
    live.iconStatuses.push(status)
  }
}))

// Never touched: every repository call below is stubbed.
vi.mock('../db', () => ({ getDb: () => null }))

vi.mock('../db/repositories/recordings.repo', () => ({
  createRecording: () => {
    live.createdRecordings += 1
    return RECORDING_ID
  },
  deleteRecording: (_db: unknown, recordingId: number) => {
    live.deleted.push(recordingId)
  },
  finishRecording: (_db: unknown, recordingId: number, _endedAt: number, path: string) => {
    live.finished.push({ recordingId, path })
  },
  insertRecordingEvents: () => {}
}))

vi.mock('../services/recordingService', () => ({
  bindPendingRecordings: () => {},
  broadcastRecordingsChanged: () => {}
}))

vi.mock('../services/captureSettings', () => ({ getCaptureSettings: () => live.settings }))

vi.mock('../obs/client', () => ({
  getObsConnectionState: () => live.connection,
  getObsLastError: () => null,
  isObsConnected: () => live.connection === 'connected',
  onObsConnectionChange: (cb: ConnectionListener) => {
    live.connectionListeners.push(cb)
    return () => {}
  },
  onObsRecordState: (cb: RecordListener) => {
    live.recordListeners.push(cb)
    return () => {}
  },
  startObsClient: () => {
    live.startObsCalls += 1
  }
}))

vi.mock('../obs/provision', () => ({
  enterManagedMode: () => Promise.resolve(true),
  leaveManagedMode: () => Promise.resolve(),
  startRecording: () => {
    live.startRecordCalls += 1
    return Promise.resolve()
  },
  stopRecording: () => Promise.resolve(null)
}))

vi.mock('../obs/config', () => ({ setCurrentScene: () => Promise.resolve() }))
vi.mock('../obs/launch', () => ({ launchObs: () => Promise.resolve() }))

vi.mock('../services/liveClientService', () => ({
  getScoreboard: () => Promise.resolve(live.board)
}))

vi.mock('../liveClient/client', () => ({
  liveClientGet: () => Promise.resolve({ Events: live.events }),
  isNotRunning: () => false
}))

type CaptureService = typeof import('./captureService')

let service: CaptureService | null = null
let folder = ''

/**
 * A fresh copy of the service per test.
 *
 * It holds the session in module state and initCapture refuses to run twice, so
 * a shared instance would let one test's session decide the next one's.
 */
async function load(): Promise<CaptureService> {
  vi.resetModules()
  service = await import('./captureService')
  return service
}

/**
 * Lets the awaits inside a poll settle — scoreboard, event feed, OBS calls.
 *
 * The service runs its effects without awaiting them, so advancing the clock
 * only gets as far as the first suspension point; the rest is microtasks.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

function fireRecordState(state: string, path: string | null = null): void {
  for (const listener of live.recordListeners) {
    listener({ active: state.endsWith('_STARTED'), state, path })
  }
}

function fireConnectionChange(): void {
  for (const listener of live.connectionListeners) listener(live.connection, null)
}

/** The one player the service actually reads: the account being recorded. */
function self(): ScoreboardPlayer {
  return {
    slot: 0,
    gameName: 'Alluna',
    tagLine: 'NA1',
    isSelf: true,
    isBot: false,
    isDead: false,
    respawnTimer: 0,
    level: 1,
    position: null,
    teamId: 100,
    championId: 112,
    championName: 'Viktor',
    spell1Id: 4,
    spell2Id: 14,
    keystoneId: null,
    secondaryTreeId: null,
    items: [0, 0, 0, 0, 0, 0, 0],
    roleBoundItem: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 0,
    wardScore: 0
  }
}

/** Arms, polls once, and lets OBS confirm — a game recording, in three steps. */
async function recordAGame(capture: CaptureService): Promise<void> {
  capture.onGamePhase(ACCOUNT, QUEUE, true)
  await vi.advanceTimersByTimeAsync(POLL_MS)
  await flush()
  fireRecordState('OBS_WEBSOCKET_OUTPUT_STARTED')
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)

  // Real, because beginRecording creates the recording folder for OBS.
  folder = mkdtempSync(join(tmpdir(), 'foxfire-capture-'))
  live.settings = {
    enabled: false,
    mode: 'managed',
    folder,
    queues: [420, 440],
    otherQueues: false,
    audio: 'game',
    quality: 'balanced',
    obsHost: '127.0.0.1',
    obsPort: 4455,
    obsInstallPath: null,
    obsScene: null
  }
  live.connection = 'disconnected'
  live.connectionListeners = []
  live.recordListeners = []
  live.board = { gameMode: 'CLASSIC', mapName: "Summoner's Rift", gameTime: 12, players: [self()] }
  live.events = [{ EventName: 'GameStart' }]
  live.startObsCalls = 0
  live.startRecordCalls = 0
  live.createdRecordings = 0
  live.finished = []
  live.deleted = []
  live.broadcasts = []
  live.iconStatuses = []
})

afterEach(() => {
  service?.stopCapture()
  service = null
  vi.useRealTimers()
  rmSync(folder, { recursive: true, force: true })
})

describe('capture service wiring', () => {
  it('subscribes to OBS even when it starts with capture switched off', async () => {
    const capture = await load()
    capture.initCapture()

    // The subscriptions are the part that can never be added later. The
    // connection can, and refreshCapture is what adds it.
    expect(live.connectionListeners).toHaveLength(1)
    expect(live.recordListeners).toHaveLength(1)
    expect(live.startObsCalls).toBe(0)
    expect(capture.getCaptureStatus()).toEqual({ state: 'off' })
  })

  it('records a game after capture is switched on in settings', async () => {
    const capture = await load()
    // Launched with capture off, which is the default and is how this went unseen.
    capture.initCapture()

    // What the settings screen does when the user ticks the box.
    live.settings.enabled = true
    live.connection = 'connected'
    capture.refreshCapture()
    expect(live.startObsCalls).toBe(1)

    capture.onGamePhase(ACCOUNT, QUEUE, true)
    expect(capture.getCaptureStatus()).toEqual({ state: 'armed', queueId: QUEUE })

    // The game answers on loopback and its feed reports GameStart, so the next
    // poll asks OBS to roll.
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await flush()
    expect(live.startRecordCalls).toBe(1)

    // OBS confirms frames are being written. With nothing listening for this the
    // session stayed armed until the arm timeout gave up on a game being played.
    fireRecordState('OBS_WEBSOCKET_OUTPUT_STARTED')
    await flush()

    expect(live.createdRecordings).toBe(1)
    expect(capture.getCaptureStatus()).toMatchObject({
      state: 'recording',
      recordingId: RECORDING_ID
    })
  })

  it('closes the recording out when OBS reports the stop', async () => {
    const capture = await load()
    capture.initCapture()
    live.settings.enabled = true
    live.connection = 'connected'
    capture.refreshCapture()
    await recordAGame(capture)

    capture.onGamePhase(ACCOUNT, QUEUE, false)
    await flush()
    // Only the second of OBS's two stop events carries the filename.
    fireRecordState('OBS_WEBSOCKET_OUTPUT_STOPPING')
    fireRecordState('OBS_WEBSOCKET_OUTPUT_STOPPED', 'C:\\Videos\\Foxfire\\game.mkv')
    await flush()

    expect(live.finished).toEqual([
      { recordingId: RECORDING_ID, path: 'C:\\Videos\\Foxfire\\game.mkv' }
    ])
    expect(capture.getCaptureStatus()).toEqual({ state: 'idle' })
  })

  it('ignores OBS events while capture is off', async () => {
    const capture = await load()
    capture.initCapture()

    // A recording the user started in OBS themselves, with nothing armed here.
    // onRecordingStarted has no awaitingStart to match it to and drops it, which
    // is what makes subscribing while disabled free.
    fireRecordState('OBS_WEBSOCKET_OUTPUT_STARTED')
    fireRecordState('OBS_WEBSOCKET_OUTPUT_STOPPED', 'C:\\Videos\\theirs.mkv')
    await flush()

    expect(live.createdRecordings).toBe(0)
    expect(live.finished).toEqual([])
    expect(capture.getCaptureStatus()).toEqual({ state: 'off' })
  })

  it('re-broadcasts the status when OBS connects', async () => {
    const capture = await load()
    capture.initCapture()

    live.settings.enabled = true
    capture.refreshCapture()
    live.broadcasts = []
    live.iconStatuses = []

    live.connection = 'connected'
    fireConnectionChange()

    expect(live.broadcasts).toEqual([{ state: 'idle' }])
    // And the taskbar badge with it — it is driven off this same broadcast, so
    // a session with no connection listener left the dot on a stale reading.
    expect(live.iconStatuses).toEqual([{ state: 'idle' }])
  })

  it('drops the recording when OBS disappears mid-game', async () => {
    const capture = await load()
    capture.initCapture()
    live.settings.enabled = true
    live.connection = 'connected'
    capture.refreshCapture()
    await recordAGame(capture)

    live.connection = 'disconnected'
    fireConnectionChange()
    await flush()

    // Nothing playable was produced, so the row goes rather than pointing at a
    // file OBS never finished writing.
    expect(live.deleted).toEqual([RECORDING_ID])
    expect(live.finished).toEqual([])
  })
})
