import { shouldCapture } from '@shared/captureQueues'

/**
 * When a recording starts and stops, as a pure reducer.
 *
 * Extracted from the service for the same reason gameflow.ts was extracted from
 * the LCU watcher: the interesting cases are a dodge, a loading screen that
 * never resolves, and a game that vanishes mid-recording, and none of them can
 * be produced on demand by playing League. Free of Electron, the DB and OBS.
 *
 * Two clocks meet here. The League client reports a game starting and ending,
 * on a ten-second poll; the game itself only answers on loopback once the world
 * is up, minutes later. Recording is deliberately hung off the second, because
 * that is the first moment a capture source has anything to capture — starting
 * on the client's word records the loading screen, and OBS's game capture finds
 * no window and writes black frames.
 */

export type CapturePhase = 'idle' | 'armed' | 'recording' | 'stopping'

export interface CaptureSessionState {
  phase: CapturePhase
  accountId: string | null
  queueId: number | null
  recordingId: number | null
  /** When the client said a game was on, so a loading screen that never ends can be given up on. */
  armedAt: number | null
  startedAt: number | null
  /** The game clock at the first recorded frame — every event's video time is measured from it. */
  gameTimeOffset: number
}

export const INITIAL_STATE: CaptureSessionState = {
  phase: 'idle',
  accountId: null,
  queueId: null,
  recordingId: null,
  armedAt: null,
  startedAt: null,
  gameTimeOffset: 0
}

export type SessionEvent =
  /** The League client entered a playing phase. */
  | { type: 'gameStarted'; accountId: string; queueId: number | null; at: number }
  /** The game answered on loopback, so there is finally something to capture. */
  | { type: 'gameReady'; gameTime: number; at: number }
  | { type: 'recordingStarted'; recordingId: number; at: number }
  /** The client left the playing phase — the ordinary end of a game. */
  | { type: 'gameEnded'; at: number }
  /** The game stopped answering while recording: a crash, or alt-F4. */
  | { type: 'gameGone'; at: number }
  | { type: 'recordingStopped'; at: number }
  /** OBS went away, capture was switched off, or setup failed. */
  | { type: 'aborted'; reason: string }
  | { type: 'tick'; at: number }

export type SessionEffect =
  | { type: 'none' }
  | {
      type: 'beginRecording'
      accountId: string
      queueId: number | null
      gameTime: number
      at: number
    }
  | { type: 'endRecording'; recordingId: number }
  /** Give up without a usable recording. `recordingId` is null if none was ever created. */
  | { type: 'abandon'; recordingId: number | null; reason: string }

export interface CaptureConfig {
  enabled: boolean
  /** Recording cannot start without somewhere to put the file. */
  hasFolder: boolean
  queues: readonly number[]
  otherQueues: boolean
}

/**
 * How long to wait for a game to come up after the client says one is on.
 *
 * Generous on purpose. A slow machine on patch day can sit in the loading
 * screen for several minutes, and giving up early means silently missing the
 * game. The only thing this really guards against is a client that reported a
 * game and then stopped talking to us altogether.
 */
export const ARM_TIMEOUT_MS = 10 * 60 * 1000

export interface Reduction {
  state: CaptureSessionState
  effect: SessionEffect
}

function idle(): CaptureSessionState {
  return { ...INITIAL_STATE }
}

function stay(state: CaptureSessionState): Reduction {
  return { state, effect: { type: 'none' } }
}

export function reduce(
  state: CaptureSessionState,
  event: SessionEvent,
  config: CaptureConfig
): Reduction {
  switch (event.type) {
    case 'gameStarted': {
      // Already following a game. A second report is just the next poll tick
      // saying the same thing.
      if (state.phase !== 'idle') return stay(state)
      if (!config.enabled || !config.hasFolder) return stay(state)
      if (!shouldCapture(event.queueId, config.queues, config.otherQueues)) return stay(state)

      return stay({
        ...idle(),
        phase: 'armed',
        accountId: event.accountId,
        queueId: event.queueId,
        armedAt: event.at
      })
    }

    case 'gameReady': {
      if (state.phase !== 'armed' || state.accountId === null) return stay(state)

      // The state does not advance to 'recording' here: OBS has to confirm it
      // actually started. Staying armed means a failed start falls out through
      // the arm timeout rather than leaving a recording that never existed.
      return {
        state,
        effect: {
          type: 'beginRecording',
          accountId: state.accountId,
          queueId: state.queueId,
          gameTime: event.gameTime,
          at: event.at
        }
      }
    }

    case 'recordingStarted': {
      if (state.phase !== 'armed') return stay(state)
      return stay({
        ...state,
        phase: 'recording',
        recordingId: event.recordingId,
        startedAt: event.at
      })
    }

    case 'gameEnded':
    case 'gameGone': {
      // A game that ends before the world came up is a dodge or a client that
      // backed out. Nothing was recorded, so there is nothing to clean up.
      if (state.phase === 'armed') return { state: idle(), effect: { type: 'none' } }

      if (state.phase === 'recording' && state.recordingId !== null) {
        return {
          state: { ...state, phase: 'stopping' },
          effect: { type: 'endRecording', recordingId: state.recordingId }
        }
      }
      return stay(state)
    }

    case 'recordingStopped': {
      if (state.phase !== 'stopping' && state.phase !== 'recording') return stay(state)
      return { state: idle(), effect: { type: 'none' } }
    }

    case 'aborted': {
      if (state.phase === 'idle') return stay(state)
      return {
        state: idle(),
        effect: { type: 'abandon', recordingId: state.recordingId, reason: event.reason }
      }
    }

    case 'tick': {
      if (state.phase !== 'armed' || state.armedAt === null) return stay(state)
      if (event.at - state.armedAt < ARM_TIMEOUT_MS) return stay(state)
      return {
        state: idle(),
        effect: { type: 'abandon', recordingId: null, reason: 'The game never started.' }
      }
    }
  }
}

/** Whether the loopback poll needs to be running — it is not free, so it is not always on. */
export function needsGamePolling(state: CaptureSessionState): boolean {
  return state.phase === 'armed' || state.phase === 'recording'
}
