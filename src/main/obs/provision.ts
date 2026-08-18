import { createLogger } from '../telemetry/logger'
import { isObsConnected, obsCall, obsTry } from './client'
import {
  setCurrentScene,
  setRecordDirectory,
  setRecordFormat,
  setRecordQuality,
  setVideoOutput
} from './config'
import { captureQualityOption, OBS_RECORD_QUALITY } from '@shared/captureQuality'
import type { CaptureAudio, CaptureQuality } from '@shared/types'

/**
 * Managed mode: an OBS profile and scene collection this app owns outright.
 *
 * The alternative — writing the recording format, output folder and audio mutes
 * into whatever profile the user happens to have selected — silently rewrites
 * the settings of anybody who also streams. A profile and a scene collection
 * are the two units OBS itself isolates settings with, so taking one of each
 * and switching into them for the duration of a game means nothing we do is
 * visible in the setup they built.
 *
 * The cost is that entering and leaving are stateful, and OBS applies both
 * switches asynchronously. Hence the settle polls below.
 */
const log = createLogger('obs')

const PROFILE = 'LoL Stats Capture'
const COLLECTION = 'LoL Stats Capture'
const SCENE = 'League'
const GAME_INPUT = 'League of Legends'
const DESKTOP_INPUT = 'LoL Stats Desktop Audio'
const MIC_INPUT = 'LoL Stats Microphone'

/**
 * OBS's own window spec, "title:class:executable".
 *
 * The game window, not the client: the client is a separate process with a
 * different class, and capturing it would record the post-game screen and
 * nothing else.
 */
const LEAGUE_WINDOW = 'League of Legends (TM) Client:RiotWindowClass:League of Legends.exe'

/** What was selected before we switched, so it can be put back. */
let previous: { profile: string | null; collection: string | null } | null = null

async function settle(read: () => Promise<string | null>, want: string): Promise<void> {
  // OBS acknowledges the request and then does the work, so a read taken right
  // after a switch still reports the old name. Six tries at 250ms is well
  // beyond what a collection switch takes and still bounded.
  for (let i = 0; i < 6; i++) {
    if ((await read()) === want) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  log.debug('OBS switch did not settle', { want })
}

async function currentProfile(): Promise<string | null> {
  const result = await obsTry<{ currentProfileName: string; profiles: string[] }>('GetProfileList')
  return result?.currentProfileName ?? null
}

async function currentCollection(): Promise<string | null> {
  const result = await obsTry<{
    currentSceneCollectionName: string
    sceneCollections: string[]
  }>('GetSceneCollectionList')
  return result?.currentSceneCollectionName ?? null
}

async function ensureProfile(): Promise<void> {
  const result = await obsTry<{ currentProfileName: string; profiles: string[] }>('GetProfileList')
  if (!result) return
  if (!result.profiles.includes(PROFILE)) await obsTry('CreateProfile', { profileName: PROFILE })
  if (result.currentProfileName !== PROFILE) {
    await obsTry('SetCurrentProfile', { profileName: PROFILE })
    await settle(currentProfile, PROFILE)
  }
}

async function ensureCollection(): Promise<boolean> {
  const result = await obsTry<{
    currentSceneCollectionName: string
    sceneCollections: string[]
  }>('GetSceneCollectionList')
  if (!result) return false

  const isNew = !result.sceneCollections.includes(COLLECTION)
  if (isNew) {
    // CreateSceneCollection also switches to it, and the new collection starts
    // with one empty scene — which is why the sources are built afterwards.
    await obsTry('CreateSceneCollection', { sceneCollectionName: COLLECTION })
  } else if (result.currentSceneCollectionName !== COLLECTION) {
    await obsTry('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION })
  }
  await settle(currentCollection, COLLECTION)
  return isNew
}

async function sceneExists(name: string): Promise<boolean> {
  const result = await obsTry<{ scenes: Array<{ sceneName: string }> }>('GetSceneList')
  return result?.scenes.some((scene) => scene.sceneName === name) ?? false
}

async function inputExists(name: string): Promise<boolean> {
  const result = await obsTry<{ inputs: Array<{ inputName: string }> }>('GetInputList')
  return result?.inputs.some((input) => input.inputName === name) ?? false
}

/**
 * Existing audio inputs of a given kind, whatever they are called.
 *
 * A fresh OBS profile already carries a global Desktop Audio and Mic/Aux, so
 * adding our own of the same kind opened a second loopback capture of the same
 * endpoint. Finding what is already there and driving that instead is both
 * fewer capture handles and the way OBS is meant to be configured.
 */
async function inputsOfKind(kind: string): Promise<string[]> {
  const result = await obsTry<{ inputs: Array<{ inputName: string; inputKind: string }> }>(
    'GetInputList'
  )
  return (result?.inputs ?? []).filter((i) => i.inputKind === kind).map((i) => i.inputName)
}

/**
 * Silences OBS's monitoring on an input.
 *
 * Monitoring plays captured audio back out through the monitoring device, which
 * arrives a buffer or two behind the game's own output and is heard as an echo
 * or a delay. Set explicitly rather than trusted to default, so this app can
 * never be the cause of it.
 */
async function stopMonitoring(inputName: string): Promise<void> {
  await obsTry('SetInputAudioMonitorType', {
    inputName,
    monitorType: 'OBS_MONITORING_TYPE_NONE'
  })
}

/**
 * The Game Capture settings, applied whether the source is new or already there.
 *
 * Re-applied rather than only set at creation, because a collection built by an
 * earlier version of this app still carries whatever it was made with — and one
 * of these settings is the audio hook.
 */
const GAME_CAPTURE_SETTINGS = {
  capture_mode: 'window',
  window: LEAGUE_WINDOW,
  // Match on the executable when the window title does not line up — League's
  // title carries a trademark symbol that has moved between patches, and the
  // process name has not.
  priority: 2,
  capture_cursor: true,
  // Off, explicitly. Game Capture's audio option injects an audio hook into the
  // game process, and that hook is a known cause of added latency in the game's
  // own output — intolerable in a game played on sound cues. Desktop audio is
  // captured passively off the output device instead, where nothing is hooked.
  capture_audio: false
} as const

async function ensureScene(audio: CaptureAudio): Promise<void> {
  if (!(await sceneExists(SCENE))) await obsTry('CreateScene', { sceneName: SCENE })

  if (await inputExists(GAME_INPUT)) {
    await obsTry('SetInputSettings', {
      inputName: GAME_INPUT,
      inputSettings: GAME_CAPTURE_SETTINGS,
      overlay: true
    })
  } else {
    await obsTry('CreateInput', {
      sceneName: SCENE,
      inputName: GAME_INPUT,
      inputKind: 'game_capture',
      inputSettings: GAME_CAPTURE_SETTINGS
    })
  }

  // Only created if OBS has nothing of the kind already. A fresh profile has a
  // global Desktop Audio, and adding ours alongside it captured the same output
  // device twice.
  if ((await inputsOfKind('wasapi_output_capture')).length === 0) {
    await obsTry('CreateInput', {
      sceneName: SCENE,
      inputName: DESKTOP_INPUT,
      inputKind: 'wasapi_output_capture',
      inputSettings: { device_id: 'default' }
    })
  }

  // The microphone is only opened if it is actually wanted. A muted source
  // still holds a capture handle on the device, which is not something to do
  // to somebody who asked for game audio only.
  if (audio === 'game+mic' && (await inputsOfKind('wasapi_input_capture')).length === 0) {
    await obsTry('CreateInput', {
      sceneName: SCENE,
      inputName: MIC_INPUT,
      inputKind: 'wasapi_input_capture',
      inputSettings: { device_id: 'default' }
    })
  }
}

/**
 * Applies the audio choice across every audio input in our own collection.
 *
 * By kind rather than by name, so the profile's own global Desktop Audio is
 * driven too. Muting only the sources we named left OBS's global one recording
 * regardless of the setting, and capturing the output device twice over.
 */
export async function applyManagedAudio(audio: CaptureAudio): Promise<void> {
  const wantDesktop = audio === 'game' || audio === 'game+mic'
  const wantMic = audio === 'game+mic'

  for (const [kind, wanted] of [
    ['wasapi_output_capture', wantDesktop],
    ['wasapi_input_capture', wantMic]
  ] as const) {
    // OBS's own global device is preferred over one this app added, so a
    // collection that ended up with both settles on the one that was already
    // there. Only that one is unmuted: leaving two live would record the same
    // device twice and mix it with itself.
    const inputs = (await inputsOfKind(kind)).sort((a, b) => {
      const ours = (name: string): number => (name.startsWith('LoL Stats ') ? 1 : 0)
      return ours(a) - ours(b)
    })

    for (const [index, inputName] of inputs.entries()) {
      await obsTry('SetInputMute', { inputName, inputMuted: !wanted || index > 0 })
      await stopMonitoring(inputName)
    }
  }
}

/**
 * Switches OBS into this app's profile and scene collection and makes sure they
 * are set up to record the game.
 *
 * Returns false if OBS could not be brought into a recordable state, so the
 * caller can report the failure instead of starting a recording of nothing.
 */
export async function enterManagedMode(
  folder: string,
  audio: CaptureAudio,
  quality: CaptureQuality
): Promise<boolean> {
  if (!isObsConnected()) return false

  // Captured before the first switch, or the "previous" profile would be ours.
  previous = { profile: await currentProfile(), collection: await currentCollection() }

  try {
    await ensureProfile()
    await ensureCollection()
    await ensureScene(audio)

    await setRecordFormat('mp4')
    await setRecordDirectory(folder)

    // Re-applied every time rather than only when the profile is built. A
    // profile made by an earlier version keeps whatever it was born with, so a
    // setting changed in this app would otherwise never reach OBS.
    const { width, height, fps } = captureQualityOption(quality)
    await setVideoOutput(width, height, fps)
    await setRecordQuality(OBS_RECORD_QUALITY)

    await applyManagedAudio(audio)
    await setCurrentScene(SCENE)
    return true
  } catch (err) {
    log.debug('Managed OBS setup failed', { error: String(err) })
    await leaveManagedMode()
    return false
  }
}

/**
 * Puts back whatever the user had selected.
 *
 * Best-effort and never throws: this runs after a recording stops, and a
 * failure to restore must not be able to lose the recording that just finished.
 */
export async function leaveManagedMode(): Promise<void> {
  const restore = previous
  previous = null
  if (!restore || !isObsConnected()) return

  if (restore.collection && restore.collection !== COLLECTION) {
    await obsTry('SetCurrentSceneCollection', { sceneCollectionName: restore.collection })
    await settle(currentCollection, restore.collection)
  }
  if (restore.profile && restore.profile !== PROFILE) {
    await obsTry('SetCurrentProfile', { profileName: restore.profile })
  }
}

/** The source the settings preview screenshots in managed mode. */
export function managedPreviewSource(): string {
  return GAME_INPUT
}

/** Whether OBS is currently sitting in our own collection. */
export async function inManagedCollection(): Promise<boolean> {
  return (await currentCollection()) === COLLECTION
}

export async function startRecording(): Promise<void> {
  await obsCall('StartRecord')
}

/** Returns the file OBS wrote, which is the first time we learn its name. */
export async function stopRecording(): Promise<string | null> {
  const result = await obsTry<{ outputPath: string }>('StopRecord')
  return result?.outputPath ?? null
}
