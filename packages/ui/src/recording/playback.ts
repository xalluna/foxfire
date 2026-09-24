/**
 * What the recording player needs from whatever is playing the video.
 *
 * Two things play a recording. The file on this machine's disk, which is a
 * `<video>` element the player drives directly; and a copy on YouTube, which
 * plays inside YouTube's own frame and can only be driven from outside it.
 * The marker strip under the video does not care which: it needs to seek, and
 * to know where the playhead is and how long the video runs.
 *
 * How the YouTube frame is reached differs by client — a browser loads
 * YouTube's IFrame API into the page, and the desktop keeps it in a separate
 * origin of its own so Google's script never shares a window with the IPC
 * bridge — so the player takes a mount function rather than knowing either.
 */

export interface PlaybackState {
  /** The video has loaded far enough to know how long it is. */
  ready: boolean
  playing: boolean
  /** Seconds. */
  currentTime: number
  /** Seconds, or 0 until known. */
  duration: number
  /** Why the video will not play, in words; null while it can. */
  error: string | null
}

export const INITIAL_PLAYBACK: PlaybackState = {
  ready: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  error: null
}

/** A playing video, from outside. */
export interface PlaybackController {
  play(): void
  pause(): void
  seek(seconds: number): void
  /** Called with every change, and once straight away with the state as it is. */
  subscribe(listener: (state: PlaybackState) => void): () => void
  /** Takes the frame down. The controller is spent afterwards. */
  destroy(): void
}

/** Puts a YouTube player for `videoId` inside `container`, and hands back its controls. */
export type YouTubeMount = (container: HTMLElement, videoId: string) => PlaybackController

/** What a recording plays from. */
export type PlayerSource =
  | { kind: 'file'; src: string }
  | { kind: 'youtube'; videoId: string; mount: YouTubeMount }
