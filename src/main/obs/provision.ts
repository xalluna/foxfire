import { createLogger } from '../telemetry/logger'
import { isObsConnected, obsCall, obsTry } from './client'
import { setCurrentScene, setRecordDirectory, setRecordFormat } from './config'
import type { CaptureAudio } from '@shared/types'

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

async function ensureScene(): Promise<void> {
  if (!(await sceneExists(SCENE))) await obsTry('CreateScene', { sceneName: SCENE })

  if (!(await inputExists(GAME_INPUT))) {
    await obsTry('CreateInput', {
      sceneName: SCENE,
      inputName: GAME_INPUT,
      inputKind: 'game_capture',
      inputSettings: {
        capture_mode: 'window',
        window: LEAGUE_WINDOW,
        // Match on the executable when the window title does not line up —
        // League's title carries a trademark symbol that has moved between
        // patches, and the process name has not.
        priority: 2,
        capture_cursor: true
      }
    })
  }

  for (const [name, kind] of [
    [DESKTOP_INPUT, 'wasapi_output_capture'],
    [MIC_INPUT, 'wasapi_input_capture']
  ] as const) {
    if (!(await inputExists(name))) {
      // Both are created up front and muted per the setting, rather than
      // created on demand: adding an input mid-recording is not something OBS
      // handles gracefully, and an unused muted input costs nothing.
      await obsTry('CreateInput', {
        sceneName: SCENE,
        inputName: name,
        inputKind: kind,
        inputSettings: { device_id: 'default' }
      })
    }
  }
}

/** Applies the audio choice by muting inputs we created ourselves. */
export async function applyManagedAudio(audio: CaptureAudio): Promise<void> {
  const wantDesktop = audio === 'game' || audio === 'game+mic'
  const wantMic = audio === 'game+mic'

  await obsTry('SetInputMute', { inputName: DESKTOP_INPUT, inputMuted: !wantDesktop })
  await obsTry('SetInputMute', { inputName: MIC_INPUT, inputMuted: !wantMic })
}

/**
 * Switches OBS into this app's profile and scene collection and makes sure they
 * are set up to record the game.
 *
 * Returns false if OBS could not be brought into a recordable state, so the
 * caller can report the failure instead of starting a recording of nothing.
 */
export async function enterManagedMode(folder: string, audio: CaptureAudio): Promise<boolean> {
  if (!isObsConnected()) return false

  // Captured before the first switch, or the "previous" profile would be ours.
  previous = { profile: await currentProfile(), collection: await currentCollection() }

  try {
    await ensureProfile()
    await ensureCollection()
    await ensureScene()

    await setRecordFormat('mp4')
    await setRecordDirectory(folder)
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
