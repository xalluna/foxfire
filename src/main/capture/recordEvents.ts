/**
 * Reading OBS's recording-state events.
 *
 * OBS reports a recording starting and stopping in two steps each, and only the
 * second one carries the filename: a stop emits OBS_WEBSOCKET_OUTPUT_STOPPING
 * with `outputPath: null`, then OBS_WEBSOCKET_OUTPUT_STOPPED with the real
 * path. Acting on `outputActive` alone therefore closes the recording out on
 * the first event, with no filename, and then ignores the one that had it —
 * which is exactly how a perfectly good 1GB capture ended up recorded as
 * missing.
 *
 * Pure, so the sequence can be replayed in a test. Nothing about this is
 * observable without finishing a real game, which is why it needs to be.
 */

/** What one RecordStateChanged event means for the capture session. */
export type RecordSignal = 'started' | 'finished' | 'ignore'

export interface RecordStateEvent {
  active: boolean
  /** OBS's own state name, e.g. OBS_WEBSOCKET_OUTPUT_STOPPED. */
  state: string
  /** Set only on the stop that carries the finished file. */
  path: string | null
}

export function recordSignalFor(event: RecordStateEvent): RecordSignal {
  const state = event.state.toUpperCase()

  // Matched on the suffix rather than the full constant so this does not depend
  // on OBS keeping the OBS_WEBSOCKET_ prefix it has changed once already.
  if (state.endsWith('_STARTED')) return 'started'
  if (state.endsWith('_STOPPED')) return 'finished'

  // STARTING, STOPPING, PAUSED and RESUMED all land here. RESUMED matters most:
  // it reports outputActive true, and treating that as a start would open a
  // second recording for a game already being recorded.
  if (state !== '') return 'ignore'

  // No state at all. The field is required by the protocol, so this should be
  // unreachable — but falling back to the flag is better than a recording that
  // never closes. The filename may be missing, which finaliseRecording handles.
  return event.active ? 'started' : 'finished'
}

/**
 * The filename to record, preferring the event's over the reply to StopRecord.
 *
 * Both are asked for because either can be absent: the reply is lost if the
 * request throws, and the event's is null on every state but the final one.
 */
export function resolveOutputPath(
  eventPath: string | null,
  stopReplyPath: string | null
): string | null {
  const chosen = eventPath ?? stopReplyPath
  return chosen === null || chosen.trim() === '' ? null : chosen
}
