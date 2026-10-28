import type { CaptureMicrophone } from './types'

/**
 * The bridge the native recorder's audio page talks to main through — the
 * whole of what that page can do. See main/capture/native/audioCapture.ts.
 */

/**
 * Its channels, kept here rather than in main/ipc/channels.ts with the rest.
 *
 * Preloads run sandboxed and can load nothing of their own but themselves: a
 * module both preloads imported would be split into a chunk of its own, which
 * neither could then load — the app's own preload included. So this page's
 * preload imports nothing the main preload does, and the build refuses a
 * preload with a shared chunk (see electron.vite.config.ts).
 */
export const CAPTURE_AUDIO_CHANNELS = {
  start: 'captureAudio:start',
  stop: 'captureAudio:stop',
  started: 'captureAudio:started',
  failed: 'captureAudio:failed',
  /** Interleaved stereo float samples at 48 kHz, about 20 ms at a time. */
  chunk: 'captureAudio:chunk',
  listMicrophones: 'captureAudio:listMicrophones',
  microphones: 'captureAudio:microphones'
} as const

export interface CaptureAudioStart {
  /** Mix the microphone in with the PC's sound. */
  mic: boolean
  /** null is the system default microphone. */
  micDeviceId: string | null
}

export interface CaptureAudioBridge {
  onStart(cb: (options: CaptureAudioStart) => void): void
  onStop(cb: () => void): void
  onListMicrophones(cb: () => void): void
  started(): void
  failed(message: string): void
  /** Interleaved stereo float samples at 48 kHz. */
  chunk(samples: ArrayBuffer): void
  microphones(list: CaptureMicrophone[]): void
}

/** Every chunk is this long: short enough to keep latency low, long enough not to flood IPC. */
export const CAPTURE_AUDIO_CHUNK_MS = 20
export const CAPTURE_AUDIO_SAMPLE_RATE = 48_000
