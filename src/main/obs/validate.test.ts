import { describe, expect, it } from 'vitest'
import { describeObsProblem, validateObs, type ObsConfigReading } from './validate'

const FOLDER = 'C:\\Videos\\LoL Stats'

function reading(over: Partial<ObsConfigReading> = {}): ObsConfigReading {
  return {
    connected: true,
    recordFormat: 'mp4',
    // OBS reports forward slashes even on Windows.
    recordDirectory: 'C:/Videos/LoL Stats',
    scenes: ['Streaming', 'League'],
    sceneItems: [
      { name: 'League of Legends', kind: 'game_capture' },
      { name: 'Webcam', kind: 'dshow_input' }
    ],
    audioInputs: [
      { name: 'Desktop Audio', muted: false },
      { name: 'Mic/Aux', muted: true }
    ],
    ...over
  }
}

const EXPECT = { managed: false, scene: 'League', folder: FOLDER }

describe('validateObs', () => {
  it('passes a scene that captures the game into the right folder as MP4', () => {
    const result = validateObs(reading(), EXPECT)

    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('reports only the disconnection, rather than guessing at settings it could not read', () => {
    const result = validateObs(
      reading({ connected: false, recordFormat: null, scenes: [] }),
      EXPECT
    )

    expect(result.problems).toEqual([{ kind: 'notConnected' }])
  })

  it('rejects MKV, which records perfectly and then will not play', () => {
    const result = validateObs(reading({ recordFormat: 'mkv' }), EXPECT)

    expect(result.ok).toBe(false)
    expect(result.problems).toContainEqual({ kind: 'recordFormat', found: 'mkv' })
    expect(describeObsProblem(result.problems[0]!)).toContain('MP4')
  })

  it.each(['mp4', 'fragmented_mp4', 'hybrid_mp4'])(
    'accepts %s, including the crash-safe variants somebody picked MKV to get',
    (format) => {
      expect(validateObs(reading({ recordFormat: format }), EXPECT).ok).toBe(true)
    }
  )

  it('does not care that OBS spells the path with forward slashes', () => {
    const result = validateObs(
      reading({ recordDirectory: 'c:/videos/lol stats/' }),
      EXPECT
    )

    expect(result.problems).not.toContainEqual(
      expect.objectContaining({ kind: 'recordDirectory' })
    )
  })

  it('reports a folder OBS is not actually writing to', () => {
    const result = validateObs(reading({ recordDirectory: 'C:/Users/me/Videos' }), EXPECT)

    expect(result.problems).toContainEqual({
      kind: 'recordDirectory',
      found: 'C:/Users/me/Videos',
      expected: FOLDER
    })
  })

  it('asks for a scene before complaining about what is in one', () => {
    const result = validateObs(reading(), { managed: false, scene: null, folder: FOLDER })

    expect(result.problems).toContainEqual({ kind: 'sceneNotChosen' })
    expect(result.problems).not.toContainEqual(
      expect.objectContaining({ kind: 'noCaptureSource' })
    )
  })

  it('names the scene that went missing, because renaming one in OBS is routine', () => {
    const result = validateObs(reading({ scenes: ['Streaming'] }), EXPECT)

    expect(result.problems).toContainEqual({ kind: 'sceneMissing', scene: 'League' })
  })

  it('catches a scene that would record nothing but a webcam', () => {
    const result = validateObs(
      reading({ sceneItems: [{ name: 'Webcam', kind: 'dshow_input' }] }),
      EXPECT
    )

    expect(result.problems).toContainEqual({ kind: 'noCaptureSource', scene: 'League' })
  })

  it.each(['game_capture', 'window_capture', 'monitor_capture', 'display_capture'])(
    'accepts %s as a way to see the game',
    (kind) => {
      const result = validateObs(reading({ sceneItems: [{ name: 'src', kind }] }), EXPECT)
      expect(result.ok).toBe(true)
    }
  )

  it('asks for a folder before checking whether OBS writes to it', () => {
    const result = validateObs(reading(), { managed: false, scene: 'League', folder: null })

    expect(result.problems).toContainEqual({ kind: 'noFolder' })
    expect(result.problems).not.toContainEqual(
      expect.objectContaining({ kind: 'recordDirectory' })
    )
  })

  it('leaves managed mode alone about settings it sets itself', () => {
    // Format, output folder and scene all live in a profile this app owns, so
    // telling the user to go and change them in OBS would be nonsense.
    const result = validateObs(
      reading({ recordFormat: 'mkv', recordDirectory: 'C:/elsewhere', scenes: [] }),
      { managed: true, scene: null, folder: FOLDER }
    )

    expect(result.ok).toBe(true)
  })

  it('still needs a folder and a connection in managed mode', () => {
    expect(
      validateObs(reading(), { managed: true, scene: null, folder: null }).problems
    ).toEqual([{ kind: 'noFolder' }])
    expect(
      validateObs(reading({ connected: false }), { managed: true, scene: null, folder: FOLDER })
        .problems
    ).toEqual([{ kind: 'notConnected' }])
  })

  it('returns the scene list even when something is wrong, so the picker still works', () => {
    const result = validateObs(reading({ recordFormat: 'mkv' }), EXPECT)

    expect(result.scenes).toEqual(['Streaming', 'League'])
    expect(result.audioInputs).toHaveLength(2)
  })

  it('reports what audio the scene will capture rather than changing it', () => {
    const result = validateObs(reading(), EXPECT)

    // Manual mode never touches a scene it did not create — muting an input we
    // do not own risks leaving somebody's mic muted after a crash.
    expect(result.audioInputs).toEqual([
      { name: 'Desktop Audio', muted: false },
      { name: 'Mic/Aux', muted: true }
    ])
  })
})
