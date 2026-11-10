import type { RecordingEmbed } from '@foxfire/core'

/**
 * What the recording player needs from whatever is playing the video.
 *
 * Two things play a recording. The file on this machine's disk, which is a
 * `<video>` element; and the copy on the server's Foxfire Media, which plays
 * inside Foxfire Media's own frame and can only be driven from outside it,
 * over its control API. Foxfire's controls do not care which: they drive a
 * controller, and draw the state it reports.
 *
 * How Foxfire Media's frame is reached differs by client — a browser frames it
 * directly, from the one origin Foxfire Media accepts; the desktop, whose
 * window is a file:// page it will not accept, frames it through a relay page
 * on the server — so the player takes a mount function rather than knowing either.
 */

export interface PlaybackState {
  /** The video has loaded far enough to know how long it is. */
  ready: boolean
  playing: boolean
  /** Seconds. */
  currentTime: number
  /** Seconds, or 0 until known. */
  duration: number
  /** 0 to 1. */
  volume: number
  muted: boolean
  rate: number
  /** What has loaded, as [start, end] seconds. */
  buffered: ReadonlyArray<readonly [number, number]>
  /** Why the video will not play, in words; null while it can. */
  error: string | null
}

export const INITIAL_PLAYBACK: PlaybackState = {
  ready: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  rate: 1,
  buffered: [],
  error: null
}

/** A playing video, from outside. */
export interface PlaybackController {
  play(): void
  pause(): void
  seek(seconds: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setRate(rate: number): void
  /** Called with every change, and once straight away with the state as it is. */
  subscribe(listener: (state: PlaybackState) => void): () => void
  /** Takes the frame down. The controller is spent afterwards. */
  destroy(): void
}

/** Puts Foxfire Media's player for an embed inside `container`, and hands back its controls. */
export type MediaMount = (container: HTMLElement, embedUrl: string) => PlaybackController

/** What a recording plays from. */
export type PlayerSource =
  | { kind: 'file'; src: string }
  | {
      kind: 'media'
      /** Asks the server for a fresh embed. Called each time the player opens it. */
      embed: () => Promise<RecordingEmbed>
      mount: MediaMount
    }

/** A store of state with listeners, which is all a controller's reporting side is. */
export function playbackState(initial: PlaybackState = INITIAL_PLAYBACK): {
  get: () => PlaybackState
  set: (patch: Partial<PlaybackState>) => void
  subscribe: (listener: (state: PlaybackState) => void) => () => void
} {
  let state = initial
  const listeners = new Set<(state: PlaybackState) => void>()
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch }
      for (const listener of listeners) listener(state)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    }
  }
}

function bufferedOf(video: HTMLVideoElement): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = []
  for (let i = 0; i < video.buffered.length; i++) ranges.push([video.buffered.start(i), video.buffered.end(i)])
  return ranges
}

/** A `<video>` on this page, as a controller: the file on disk. */
export function videoController(video: HTMLVideoElement): PlaybackController {
  const store = playbackState()
  const sync = (): void =>
    store.set({
      ready: video.readyState >= HTMLMediaElement.HAVE_METADATA,
      playing: !video.paused && !video.ended,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      volume: video.volume,
      muted: video.muted,
      rate: video.playbackRate,
      buffered: bufferedOf(video)
    })

  const events = [
    'loadedmetadata',
    'durationchange',
    'timeupdate',
    'play',
    'pause',
    'ended',
    'volumechange',
    'ratechange',
    'progress',
    'seeked'
  ] as const
  for (const name of events) video.addEventListener(name, sync)
  const onError = (): void =>
    store.set({
      error:
        'The file may have been moved or deleted, or it was written in a container this app cannot read. Recording format must be MP4.'
    })
  video.addEventListener('error', onError)
  sync()

  return {
    play: () => void video.play().catch(() => undefined),
    pause: () => video.pause(),
    seek: (seconds) => {
      video.currentTime = Math.max(0, Math.min(seconds, video.duration || seconds))
    },
    setVolume: (volume) => {
      video.volume = Math.min(1, Math.max(0, volume))
    },
    setMuted: (muted) => {
      video.muted = muted
    },
    setRate: (rate) => {
      video.playbackRate = rate
    },
    subscribe: store.subscribe,
    destroy: () => {
      for (const name of events) video.removeEventListener(name, sync)
      video.removeEventListener('error', onError)
    }
  }
}
