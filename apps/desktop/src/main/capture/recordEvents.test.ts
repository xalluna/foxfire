import { describe, expect, it } from 'vitest'
import { recordSignalFor, resolveOutputPath, type RecordStateEvent } from './recordEvents'

const FILE = 'C:/Users/me/Videos/Foxfire/2026-08-18 11-21-08.mp4'

function event(over: Partial<RecordStateEvent> = {}): RecordStateEvent {
  return { active: false, state: '', path: null, ...over }
}

describe('recordSignalFor', () => {
  it('starts only once frames are actually being written', () => {
    expect(
      recordSignalFor(event({ active: false, state: 'OBS_WEBSOCKET_OUTPUT_STARTING' }))
    ).toBe('ignore')
    expect(
      recordSignalFor(event({ active: true, state: 'OBS_WEBSOCKET_OUTPUT_STARTED' }))
    ).toBe('started')
  })

  it('waits for the stop that carries the filename', () => {
    // The bug this exists for: STOPPING arrives first, reports the output as
    // inactive, and has no path. Finalising here writes a recording pointing at
    // nothing and then ignores the event that knew where the file went.
    expect(
      recordSignalFor(event({ active: false, state: 'OBS_WEBSOCKET_OUTPUT_STOPPING' }))
    ).toBe('ignore')
    expect(
      recordSignalFor(event({ active: false, state: 'OBS_WEBSOCKET_OUTPUT_STOPPED', path: FILE }))
    ).toBe('finished')
  })

  it('does not open a second recording when one is resumed', () => {
    // RESUMED reports outputActive true for a recording already in progress.
    expect(
      recordSignalFor(event({ active: true, state: 'OBS_WEBSOCKET_OUTPUT_RESUMED' }))
    ).toBe('ignore')
    expect(
      recordSignalFor(event({ active: true, state: 'OBS_WEBSOCKET_OUTPUT_PAUSED' }))
    ).toBe('ignore')
  })

  it('reads the whole sequence of a real recording as one start and one finish', () => {
    const sequence: RecordStateEvent[] = [
      event({ active: false, state: 'OBS_WEBSOCKET_OUTPUT_STARTING' }),
      event({ active: true, state: 'OBS_WEBSOCKET_OUTPUT_STARTED' }),
      event({ active: true, state: 'OBS_WEBSOCKET_OUTPUT_PAUSED' }),
      event({ active: true, state: 'OBS_WEBSOCKET_OUTPUT_RESUMED' }),
      event({ active: false, state: 'OBS_WEBSOCKET_OUTPUT_STOPPING' }),
      event({ active: false, state: 'OBS_WEBSOCKET_OUTPUT_STOPPED', path: FILE })
    ]

    expect(sequence.map(recordSignalFor)).toEqual([
      'ignore',
      'started',
      'ignore',
      'ignore',
      'ignore',
      'finished'
    ])
  })

  it('does not depend on OBS keeping its current constant prefix', () => {
    expect(recordSignalFor(event({ active: true, state: 'OUTPUT_STARTED' }))).toBe('started')
    expect(recordSignalFor(event({ active: false, state: 'OUTPUT_STOPPED' }))).toBe('finished')
  })

  it('ignores case, since this is a string off the wire', () => {
    expect(
      recordSignalFor(event({ active: false, state: 'obs_websocket_output_stopped' }))
    ).toBe('finished')
  })

  it('falls back to the active flag if a build sends no state at all', () => {
    // Should be unreachable — the field is required — but a recording that
    // never closes is worse than one closed without a filename.
    expect(recordSignalFor(event({ active: true, state: '' }))).toBe('started')
    expect(recordSignalFor(event({ active: false, state: '' }))).toBe('finished')
  })
})

describe('resolveOutputPath', () => {
  it('takes the filename from the event', () => {
    expect(resolveOutputPath(FILE, null)).toBe(FILE)
  })

  it('falls back to the reply when the event did not carry one', () => {
    expect(resolveOutputPath(null, FILE)).toBe(FILE)
  })

  it('prefers the event, which is the authoritative one', () => {
    expect(resolveOutputPath(FILE, 'C:/somewhere/else.mp4')).toBe(FILE)
  })

  it('treats an empty string as no filename rather than a file named nothing', () => {
    expect(resolveOutputPath('', null)).toBeNull()
    expect(resolveOutputPath('   ', '')).toBeNull()
  })

  it('reports having no filename when neither source had one', () => {
    expect(resolveOutputPath(null, null)).toBeNull()
  })
})
