import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  CAPTURE_AUDIO_CHANNELS as CH,
  type CaptureAudioBridge,
  type CaptureAudioStart
} from '@shared/captureAudio'
import type { CaptureMicrophone } from '@shared/types'

// The native recorder's audio page, and nothing else, runs with this preload.
// It can be told to start and stop and can hand back samples — none of the
// app's API that every other window gets through preload/index.ts. It imports
// nothing that preload does: see CAPTURE_AUDIO_CHANNELS for why.
const bridge: CaptureAudioBridge = {
  onStart: (cb) => {
    ipcRenderer.on(CH.start, (_e: IpcRendererEvent, options: CaptureAudioStart) => cb(options))
  },
  onStop: (cb) => {
    ipcRenderer.on(CH.stop, () => cb())
  },
  onListMicrophones: (cb) => {
    ipcRenderer.on(CH.listMicrophones, () => cb())
  },
  started: () => ipcRenderer.send(CH.started),
  failed: (message: string) => ipcRenderer.send(CH.failed, message),
  chunk: (samples: ArrayBuffer) => ipcRenderer.send(CH.chunk, samples),
  microphones: (list: CaptureMicrophone[]) => ipcRenderer.send(CH.microphones, list)
}

contextBridge.exposeInMainWorld('captureAudio', bridge)
