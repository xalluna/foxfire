import { describe, expect, it } from 'vitest'
import {
  ARM_TIMEOUT_MS,
  INITIAL_STATE,
  needsGamePolling,
  reduce,
  type CaptureConfig,
  type CaptureSessionState,
  type SessionEvent
} from './captureState'

const T0 = 1_700_000_000_000

const CONFIG: CaptureConfig = {
  enabled: true,
  hasFolder: true,
  queues: [420, 440],
  otherQueues: false
}

/** Feeds a sequence and returns where it ended up, ignoring the effects. */
function run(events: SessionEvent[], config = CONFIG): CaptureSessionState {
  return events.reduce(
    (state, event) => reduce(state, event, config).state,
    INITIAL_STATE as CaptureSessionState
  )
}

const started: SessionEvent = { type: 'gameStarted', accountId: 1, queueId: 420, at: T0 }
const ready: SessionEvent = { type: 'gameReady', gameTime: 42.5, at: T0 + 120_000 }
const recording: SessionEvent = { type: 'recordingStarted', replayId: 7, at: T0 + 121_000 }

describe('capture state machine', () => {
  it('arms on a queue the user switched on', () => {
    const state = run([started])

    expect(state.phase).toBe('armed')
    expect(state.queueId).toBe(420)
    expect(state.accountId).toBe(1)
  })

  it('ignores a queue the user unticked', () => {
    const state = run([{ type: 'gameStarted', accountId: 1, queueId: 450, at: T0 }])

    expect(state.phase).toBe('idle')
  })

  it('records an unlisted queue only when the catch-all is on', () => {
    // Practice Tool reports 0, which is how this gets tested without a real game.
    const practice: SessionEvent = { type: 'gameStarted', accountId: 1, queueId: 0, at: T0 }

    expect(run([practice]).phase).toBe('idle')
    expect(run([practice], { ...CONFIG, otherQueues: true }).phase).toBe('armed')
  })

  it('does not let the catch-all resurrect a queue that was unticked', () => {
    const aram: SessionEvent = { type: 'gameStarted', accountId: 1, queueId: 450, at: T0 }

    // 450 is a queue the settings screen lists by name, and it is not ticked.
    expect(run([aram], { ...CONFIG, otherQueues: true }).phase).toBe('idle')
  })

  it('treats a queue the client never reported as unrecognised', () => {
    const unknown: SessionEvent = { type: 'gameStarted', accountId: 1, queueId: null, at: T0 }

    expect(run([unknown]).phase).toBe('idle')
    expect(run([unknown], { ...CONFIG, otherQueues: true }).phase).toBe('armed')
  })

  it('stays idle when capture is off, or has nowhere to write', () => {
    expect(run([started], { ...CONFIG, enabled: false }).phase).toBe('idle')
    expect(run([started], { ...CONFIG, hasFolder: false }).phase).toBe('idle')
  })

  it('waits out the loading screen rather than recording it', () => {
    // The client says InProgress long before the game answers on loopback.
    const armed = run([started])

    expect(armed.phase).toBe('armed')
    expect(armed.replayId).toBeNull()
    expect(needsGamePolling(armed)).toBe(true)
  })

  it('asks to record only once the game itself answers', () => {
    const armed = run([started])
    const { effect } = reduce(armed, ready, CONFIG)

    expect(effect).toEqual({
      type: 'beginRecording',
      accountId: 1,
      queueId: 420,
      gameTime: 42.5,
      at: T0 + 120_000
    })
  })

  it('stays armed until OBS confirms, so a failed start is not mistaken for a recording', () => {
    const afterAsk = reduce(run([started]), ready, CONFIG).state

    expect(afterAsk.phase).toBe('armed')
    expect(run([started, ready, recording]).phase).toBe('recording')
  })

  it('gives up on a game that never comes up', () => {
    const armed = run([started])
    const late = reduce(armed, { type: 'tick', at: T0 + ARM_TIMEOUT_MS + 1 }, CONFIG)

    expect(late.state.phase).toBe('idle')
    expect(late.effect).toEqual({
      type: 'abandon',
      replayId: null,
      reason: 'The game never started.'
    })
  })

  it('keeps waiting while the loading screen is merely slow', () => {
    const armed = run([started])
    const soon = reduce(armed, { type: 'tick', at: T0 + 60_000 }, CONFIG)

    expect(soon.state.phase).toBe('armed')
    expect(soon.effect).toEqual({ type: 'none' })
  })

  it('drops a dodge without leaving anything behind', () => {
    const dodged = reduce(run([started]), { type: 'gameEnded', at: T0 + 30_000 }, CONFIG)

    expect(dodged.state.phase).toBe('idle')
    // Nothing was ever recorded, so there is nothing to abandon.
    expect(dodged.effect).toEqual({ type: 'none' })
  })

  it('stops the recording when the game ends', () => {
    const live = run([started, ready, recording])
    const ended = reduce(live, { type: 'gameEnded', at: T0 + 1_800_000 }, CONFIG)

    expect(ended.effect).toEqual({ type: 'endRecording', replayId: 7 })
    expect(ended.state.phase).toBe('stopping')
  })

  it('stops the same way when the game crashes instead of ending', () => {
    const live = run([started, ready, recording])
    const gone = reduce(live, { type: 'gameGone', at: T0 + 900_000 }, CONFIG)

    // A crash still produced footage worth keeping, so it closes out normally
    // rather than being abandoned.
    expect(gone.effect).toEqual({ type: 'endRecording', replayId: 7 })
  })

  it('returns to idle once the recording is closed', () => {
    const stopped = run([
      started,
      ready,
      recording,
      { type: 'gameEnded', at: T0 + 1_800_000 },
      { type: 'recordingStopped', at: T0 + 1_801_000 }
    ])

    expect(stopped).toEqual(INITIAL_STATE)
    expect(needsGamePolling(stopped)).toBe(false)
  })

  it('hands back the replay to clean up when OBS disappears mid-game', () => {
    const live = run([started, ready, recording])
    const lost = reduce(live, { type: 'aborted', reason: 'OBS closed' }, CONFIG)

    expect(lost.state.phase).toBe('idle')
    expect(lost.effect).toEqual({ type: 'abandon', replayId: 7, reason: 'OBS closed' })
  })

  it('ignores an abort when nothing is happening', () => {
    expect(reduce(INITIAL_STATE, { type: 'aborted', reason: 'x' }, CONFIG).effect).toEqual({
      type: 'none'
    })
  })

  it('ignores repeat game-start reports from the ten-second poll', () => {
    const live = run([started, ready, recording])
    const again = reduce(live, { type: 'gameStarted', accountId: 1, queueId: 420, at: T0 }, CONFIG)

    expect(again.state.phase).toBe('recording')
    expect(again.state.replayId).toBe(7)
  })

  it('polls loopback only while it has a game to follow', () => {
    expect(needsGamePolling(INITIAL_STATE)).toBe(false)
    expect(needsGamePolling(run([started]))).toBe(true)
    expect(needsGamePolling(run([started, ready, recording]))).toBe(true)
  })
})
