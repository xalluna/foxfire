import { isObsConnected, obsCall, obsTry } from './client'
import type { ObsConfigReading, ObsSceneItem } from './validate'
import type { ObsAudioInput } from '@shared/types'

/**
 * Reading and writing the parts of OBS's own configuration this app depends on.
 *
 * Kept apart from client.ts so the connection has no opinions about OBS's
 * settings, and apart from validate.ts so the rules stay testable without a
 * running OBS.
 */

/** Inputs OBS treats as audio; everything else has no mute to report. */
const AUDIO_INPUT_KINDS = new Set([
  'wasapi_output_capture',
  'wasapi_input_capture',
  'wasapi_process_output_capture',
  'coreaudio_output_capture',
  'coreaudio_input_capture',
  'pulse_output_capture',
  'pulse_input_capture'
])

interface ProfileParameter {
  parameterValue: string | null
  defaultParameterValue: string | null
}

/**
 * OBS keeps the recording format in a different profile section depending on
 * whether the user is in Simple or Advanced output mode, and renamed the key
 * from RecFormat to RecFormat2 in v29. Reading the wrong one yields null, which
 * would be reported to the user as "unknown format" on a perfectly good setup.
 */
async function readProfileParameter(
  category: string,
  name: string
): Promise<string | null> {
  const result = await obsTry<ProfileParameter>('GetProfileParameter', {
    parameterCategory: category,
    parameterName: name
  })
  if (!result) return null
  return result.parameterValue ?? result.defaultParameterValue ?? null
}

/** Which profile section holds the output settings right now. */
async function outputSection(): Promise<'SimpleOutput' | 'AdvOut'> {
  const mode = await readProfileParameter('Output', 'Mode')
  return mode === 'Advanced' ? 'AdvOut' : 'SimpleOutput'
}

export async function readRecordFormat(): Promise<string | null> {
  const section = await outputSection()
  return (
    (await readProfileParameter(section, 'RecFormat2')) ??
    (await readProfileParameter(section, 'RecFormat'))
  )
}

export async function setRecordFormat(format: string): Promise<void> {
  const section = await outputSection()
  // Both keys are written: an OBS old enough to read RecFormat ignores the
  // other, and a new one prefers RecFormat2. Writing only the modern name on an
  // older build silently leaves it recording MKV.
  await obsTry('SetProfileParameter', {
    parameterCategory: section,
    parameterName: 'RecFormat2',
    parameterValue: format
  })
  await obsTry('SetProfileParameter', {
    parameterCategory: section,
    parameterName: 'RecFormat',
    parameterValue: format
  })
}

/**
 * The recording quality preset, in Simple output mode.
 *
 * Left at whatever OBS defaults to until now, which meant recordings inherited
 * the stream bitrate — a constant 6 Mbps regardless of what the picture needed.
 */
export async function setRecordQuality(quality: string): Promise<void> {
  await obsTry('SetProfileParameter', {
    parameterCategory: 'SimpleOutput',
    parameterName: 'RecQuality',
    parameterValue: quality
  })
}

interface VideoSettings {
  baseWidth: number
  baseHeight: number
  outputWidth: number
  outputHeight: number
  fpsNumerator: number
  fpsDenominator: number
}

/**
 * Sets what gets encoded, leaving the canvas alone.
 *
 * The base canvas is the user's screen and is none of our business; the output
 * size is what the encoder actually works on, and is the lever that matters on
 * a machine already struggling to hold frames. Output is clamped to the canvas,
 * since upscaling past it adds encoder load for no detail.
 *
 * A dedicated request rather than profile parameters: those are read at
 * startup, so writing them would not take effect until OBS restarted.
 */
export async function setVideoOutput(width: number, height: number, fps: number): Promise<void> {
  const current = await obsTry<VideoSettings>('GetVideoSettings')
  if (!current) return

  await obsTry('SetVideoSettings', {
    baseWidth: current.baseWidth,
    baseHeight: current.baseHeight,
    outputWidth: Math.min(width, current.baseWidth),
    outputHeight: Math.min(height, current.baseHeight),
    fpsNumerator: fps,
    fpsDenominator: 1
  })
}

export async function getRecordDirectory(): Promise<string | null> {
  const result = await obsTry<{ recordDirectory: string }>('GetRecordDirectory')
  return result?.recordDirectory ?? null
}

export async function setRecordDirectory(folder: string): Promise<void> {
  await obsCall('SetRecordDirectory', { recordDirectory: folder })
}

export async function listScenes(): Promise<string[]> {
  const result = await obsTry<{ scenes: Array<{ sceneName: string }> }>('GetSceneList')
  return result?.scenes.map((scene) => scene.sceneName) ?? []
}

export async function listSceneItems(scene: string): Promise<ObsSceneItem[]> {
  const result = await obsTry<{
    sceneItems: Array<{ sourceName: string; inputKind: string | null }>
  }>('GetSceneItemList', { sceneName: scene })

  return (
    result?.sceneItems.map((item) => ({
      name: item.sourceName,
      // A group has no inputKind. It cannot be a capture source itself, so an
      // empty string simply fails the video-source test rather than crashing it.
      kind: item.inputKind ?? ''
    })) ?? []
  )
}

/**
 * The audio inputs OBS would record, with their mute state.
 *
 * Global rather than per-scene on purpose: OBS's Desktop Audio and Mic/Aux are
 * global inputs that are captured whatever scene is showing, so listing only a
 * scene's own items would report silence on a setup that records fine.
 */
export async function listAudioInputs(): Promise<ObsAudioInput[]> {
  const result = await obsTry<{ inputs: Array<{ inputName: string; inputKind: string }> }>(
    'GetInputList'
  )
  if (!result) return []

  const audio = result.inputs.filter((input) => AUDIO_INPUT_KINDS.has(input.inputKind))

  return Promise.all(
    audio.map(async (input) => {
      const mute = await obsTry<{ inputMuted: boolean }>('GetInputMute', {
        inputName: input.inputName
      })
      return { name: input.inputName, muted: mute?.inputMuted ?? false }
    })
  )
}

/** Everything validateObs needs, in one round of reads. */
export async function readObsConfig(scene: string | null): Promise<ObsConfigReading> {
  if (!isObsConnected()) {
    return {
      connected: false,
      recordFormat: null,
      recordDirectory: null,
      scenes: [],
      sceneItems: [],
      audioInputs: []
    }
  }

  const scenes = await listScenes()

  return {
    connected: true,
    recordFormat: await readRecordFormat(),
    recordDirectory: await getRecordDirectory(),
    scenes,
    // Asking for the items of a scene that is not there is an error, not an
    // empty list, so the missing-scene case is answered by validateObs instead.
    sceneItems: scene !== null && scenes.includes(scene) ? await listSceneItems(scene) : [],
    audioInputs: await listAudioInputs()
  }
}

export async function getCurrentScene(): Promise<string | null> {
  const result = await obsTry<{ currentProgramSceneName: string }>('GetCurrentProgramScene')
  return result?.currentProgramSceneName ?? null
}

export async function setCurrentScene(scene: string): Promise<void> {
  await obsCall('SetCurrentProgramScene', { sceneName: scene })
}

/**
 * A single frame of a source, as a data URI.
 *
 * Used by the settings preview so a first-time user can see what would be
 * recorded rather than finding out after a game. Small and JPEG because it is
 * polled: a full-resolution PNG every second would be megabytes across IPC.
 */
export async function grabSourceScreenshot(source: string): Promise<string | null> {
  const result = await obsTry<{ imageData: string }>('GetSourceScreenshot', {
    sourceName: source,
    imageFormat: 'jpg',
    imageWidth: 640,
    imageCompressionQuality: 60
  })
  return result?.imageData ?? null
}
