import type { GameId } from '@foxfire/core'
import type { CaptureQuality } from '@shared/captureQuality'
import type { CaptureAudio, CaptureDriver } from '@shared/types'

/**
 * What writes the video, behind the one seam the capture service drives.
 *
 * There are two: OBS, launched and told what to do over its websocket, and the
 * native recorder, an FFmpeg this app runs itself. Everything about when to
 * record — the session reducer, the game clock, the markers, filing the file and
 * finding its match — is the same for both and stays in captureService.ts. A
 * recorder only answers "can you record", starts, stops, and says when frames
 * are really being written and when the file is closed.
 *
 * Those last two are signals rather than return values because neither recorder
 * knows them when it is asked: OBS confirms a start and names the file in events
 * of its own, and both can stop without being asked — the user pressing Stop in
 * OBS, or the game window closing under FFmpeg.
 */

export type RecorderConnection =
  | { state: 'ready' }
  | { state: 'connecting' }
  | { state: 'unavailable'; message: string }

export type RecorderSignal =
  /**
   * The first frame exists. Everything on the timeline is measured from the
   * file's start, which is `at` when the recorder knows it was earlier than
   * this signal, and now when it does not.
   */
  | { kind: 'started'; at?: number }
  /** The file is closed. `path` is null when the recorder never learned it. */
  | { kind: 'finished'; path: string | null }
  /** It stopped with nothing worth keeping. The row, if one was made, goes. */
  | { kind: 'failed'; reason: string }

/** What a recording is of, and where it goes. */
export interface RecordTarget {
  game: GameId
  folder: string
  quality: CaptureQuality
  audio: CaptureAudio
  /** null is the system's default microphone. */
  micDeviceId: string | null
}

export interface Recorder {
  readonly driver: CaptureDriver
  /** Gets ready to record — called with capture on, and again on every settings change. */
  boot(): void
  /** Lets go of whatever boot took. Never throws. */
  shutdown(): Promise<void>
  connection(): RecorderConnection
  onConnectionChange(cb: () => void): void
  onSignal(cb: (signal: RecorderSignal) => void): void
  /**
   * Gets ready for a game that is still loading: whatever takes time and can
   * be done before the first frame, so the recording starts the moment the game
   * does rather than a couple of seconds into it. Never throws, and need not
   * succeed — begin does whatever prepare did not. release undoes it.
   */
  prepare(target: RecordTarget): Promise<void>
  /**
   * Asks for a recording, and rejects if the recorder cannot make one. Whether
   * it resolves before or after the first frame is the recorder's business:
   * 'started' is what says frames exist.
   */
  begin(target: RecordTarget): Promise<void>
  /** Asks the recording to stop, with the file's path if the recorder knows it now. */
  end(): Promise<string | null>
  /** Undoes whatever begin changed outside the file. Never throws. */
  release(): Promise<void>
  /** The file being written right now, where the recorder chose its name. */
  outputPath(): string | null
}
