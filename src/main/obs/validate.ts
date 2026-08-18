import type { ObsAudioInput, ObsProblem, ObsValidation } from '@shared/types'

/**
 * Whether a user-configured OBS can be recorded from as it stands.
 *
 * Pure, and free of Electron, the DB and obs-websocket, so every branch can be
 * exercised without a running OBS — which is the only practical way to check
 * copy that most users will only ever see when something is wrong.
 *
 * Managed mode passes through it too, but stops at the connection and folder
 * checks: it owns its own profile and scene collection and sets the rest
 * itself, so there is nothing there for a user to have got wrong. The full set
 * of rules is for the other mode, where we report problems and never silently
 * fix a setup we did not build.
 */

/** A source that produces video we could record the game from. */
const VIDEO_SOURCE_KINDS = new Set([
  'game_capture',
  'window_capture',
  'monitor_capture',
  'display_capture',
  // The macOS/Linux spellings, so this does not read as Windows-only logic.
  'screen_capture',
  'xcomposite_input',
  'pipewire-screen-capture-source'
])

/**
 * The containers Electron's <video> can actually play.
 *
 * OBS defaults to MKV because it survives a crash, which is a good default for
 * streaming and a useless one here: Chromium has no MKV demuxer, so the file
 * would record perfectly and then refuse to open. `hybrid_mp4` and
 * `fragmented_mp4` are OBS 30's crash-safe MP4 variants and are the right
 * answer for anybody who picked MKV for that reason.
 */
const PLAYABLE_FORMATS = new Set(['mp4', 'fragmented_mp4', 'hybrid_mp4'])

/** One source in the scene we would record. */
export interface ObsSceneItem {
  name: string
  kind: string
}

/** Everything read off a running OBS, in the shape the check needs. */
export interface ObsConfigReading {
  connected: boolean
  /** Output/RecFormat2, or null when OBS did not report one. */
  recordFormat: string | null
  recordDirectory: string | null
  scenes: string[]
  /** Sources in the chosen scene. Empty when no scene is chosen or it is gone. */
  sceneItems: ObsSceneItem[]
  audioInputs: ObsAudioInput[]
}

export interface ObsExpectation {
  /**
   * Managed mode, which sets the container, the output folder and the scene
   * itself inside a profile it owns.
   *
   * Those three then cannot be wrong, and reporting them as problems the user
   * must go and fix in OBS would be actively misleading. All that is left to
   * check is that there is an OBS to talk to and somewhere to write.
   */
  managed: boolean
  /** The scene the user picked in settings, or null if they have not yet. */
  scene: string | null
  /** The replay folder. OBS must be writing into it for us to find the file. */
  folder: string | null
}

/**
 * Compares two paths as Windows compares them.
 *
 * OBS reports forward slashes even on Windows while Electron hands back
 * backslashes, so a directory that is plainly correct otherwise reads as wrong.
 */
function samePath(a: string, b: string): boolean {
  const normalise = (value: string): string =>
    value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalise(a) === normalise(b)
}

export function validateObs(
  reading: ObsConfigReading,
  expectation: ObsExpectation
): ObsValidation {
  const problems: ObsProblem[] = []

  if (!reading.connected) {
    // Nothing else was readable, so listing further problems would be inventing
    // them. One accurate problem beats five guesses.
    return { ok: false, problems: [{ kind: 'notConnected' }], scenes: [], audioInputs: [] }
  }

  if (expectation.folder === null) {
    problems.push({ kind: 'noFolder' })
  }

  if (expectation.managed) {
    return {
      ok: problems.length === 0,
      problems,
      scenes: reading.scenes,
      audioInputs: reading.audioInputs
    }
  }

  const format = reading.recordFormat
  if (format === null || !PLAYABLE_FORMATS.has(format.toLowerCase())) {
    problems.push({ kind: 'recordFormat', found: format ?? 'unknown' })
  }

  if (
    expectation.folder !== null &&
    (reading.recordDirectory === null || !samePath(reading.recordDirectory, expectation.folder))
  ) {
    problems.push({
      kind: 'recordDirectory',
      found: reading.recordDirectory ?? 'unknown',
      expected: expectation.folder
    })
  }

  if (expectation.scene === null) {
    problems.push({ kind: 'sceneNotChosen' })
  } else if (!reading.scenes.includes(expectation.scene)) {
    // Renaming a scene in OBS is a normal thing to do and leaves the stored
    // name dangling, so this says which name went missing rather than just
    // reporting the scene as empty.
    problems.push({ kind: 'sceneMissing', scene: expectation.scene })
  } else if (!reading.sceneItems.some((item) => VIDEO_SOURCE_KINDS.has(item.kind))) {
    problems.push({ kind: 'noCaptureSource', scene: expectation.scene })
  }

  return {
    ok: problems.length === 0,
    problems,
    scenes: reading.scenes,
    audioInputs: reading.audioInputs
  }
}

/** Human copy for a problem, kept beside the check so the two cannot drift. */
export function describeObsProblem(problem: ObsProblem): string {
  switch (problem.kind) {
    case 'notConnected':
      return 'Not connected to OBS.'
    case 'noFolder':
      return 'Choose a folder for recordings first.'
    case 'recordFormat':
      return `OBS is recording as ${problem.found}. Set Settings → Output → Recording Format to MP4 — this app cannot play MKV.`
    case 'sceneNotChosen':
      return 'Pick the scene that captures League.'
    case 'sceneMissing':
      return `The scene "${problem.scene}" no longer exists in OBS.`
    case 'noCaptureSource':
      return `"${problem.scene}" has no game, window or display capture source, so it would record nothing.`
    case 'recordDirectory':
      return `OBS is saving to ${problem.found}. Point Settings → Output → Recording Path at ${problem.expected}.`
  }
}
