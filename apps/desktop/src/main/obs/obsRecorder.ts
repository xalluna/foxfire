import { getCaptureSettings } from '../services/captureSettings'
import { recordSignalFor } from '../capture/recordEvents'
import { createLogger } from '../telemetry/logger'
import type { Recorder, RecorderConnection, RecordTarget } from '../capture/recorder'
import {
  getObsConnectionState,
  getObsLastError,
  onObsConnectionChange,
  onObsRecordState,
  startObsClient,
  stopObsClient
} from './client'
import { enterManagedMode, leaveManagedMode, startRecording, stopRecording } from './provision'
import { setCurrentScene } from './config'
import { launchObs, quitLaunchedObs } from './launch'

/**
 * OBS as a recorder: the websocket client, managed mode and the launcher,
 * behind the seam the capture service drives. Nothing here decides anything new
 * — this is the sequence captureService.ts used to call directly, with setting
 * up the scene moved from the start of the game to its loading screen.
 */
const log = createLogger('obs')

/** Whether the scene is already set up for the game about to start. */
let prepared = false

async function enterScene(target: RecordTarget): Promise<void> {
  const settings = getCaptureSettings()
  if (settings.mode === 'managed') {
    const ready = await enterManagedMode(target.folder, target.audio, target.quality)
    if (!ready) throw new Error('Managed OBS setup failed')
  } else if (settings.obsScene) {
    // A user-configured scene is switched to but never edited — its sources,
    // audio and output settings are theirs. validateObs is what tells them if
    // any of that would stop the recording being playable.
    await setCurrentScene(settings.obsScene)
  }
}

export const obsRecorder: Recorder = {
  driver: 'obs',

  boot() {
    const settings = getCaptureSettings()
    // Started with the app rather than with a game: OBS takes seconds to come up
    // and accept a connection, and a loading screen does not wait. Not awaited —
    // the websocket client retries on its own, so nothing needs to block on it.
    void launchObs(settings.obsInstallPath, settings.obsHost, settings.obsPort)
    startObsClient()
  },

  async shutdown() {
    stopObsClient()
    // Only quits an OBS this app started; one the user was already running,
    // possibly mid-stream, is left alone.
    quitLaunchedObs()
  },

  connection(): RecorderConnection {
    const connection = getObsConnectionState()
    if (connection === 'connected') return { state: 'ready' }
    if (connection === 'connecting') return { state: 'connecting' }
    return { state: 'unavailable', message: getObsLastError() ?? 'Not connected to OBS.' }
  },

  onConnectionChange(cb) {
    onObsConnectionChange(() => cb())
  },

  onSignal(cb) {
    onObsRecordState((event) => {
      // OBS reports a start and a stop in two steps each, and only the second
      // carries the filename — see recordEvents.ts. Acting on outputActive alone
      // closed the recording out on the STOPPING event, with nothing to point at.
      const signal = recordSignalFor(event)
      if (signal === 'started') cb({ kind: 'started' })
      // Also fires when the user presses Stop in OBS themselves, which is a
      // reasonable thing to do and should still close the row out.
      else if (signal === 'finished') cb({ kind: 'finished', path: event.path })
    })
  },

  async prepare(target) {
    // While the game loads, not as it starts. Switching into our profile and
    // scene collection rebuilds the game capture source, which then has to
    // find the game's window and hook it — seconds of black, done at record
    // time. The window is up for the whole loading screen, so the hook has all
    // of it to land in (see hook_rate in provision.ts).
    if (prepared) return
    try {
      await enterScene(target)
      prepared = true
    } catch (err) {
      log.debug('Could not prepare OBS ahead of the game', { error: String(err) })
    }
  },

  async begin(target) {
    if (!prepared) await enterScene(target)
    prepared = false
    await startRecording()
  },

  end() {
    // OBS also announces the stop as an event, and the path in that is the one
    // preferred — see resolveOutputPath.
    return stopRecording()
  },

  release() {
    prepared = false
    return leaveManagedMode().catch(() => undefined)
  },

  outputPath() {
    // OBS names the file itself, and only says what it called it on the stop.
    return null
  }
}
