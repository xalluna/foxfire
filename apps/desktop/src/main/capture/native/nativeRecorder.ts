import { spawn as spawnProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '../../telemetry/logger'
import { captureQualityOption } from '@shared/captureQuality'
import type { CaptureAudioStart } from '@shared/captureAudio'
import type { NativeCaptureCheck } from '@shared/types'
import { GAME_WINDOWS } from '../gameWindows'
import type { Recorder, RecorderConnection, RecorderSignal, RecordTarget } from '../recorder'
import { startAudioCapture } from './audioCapture'
import { openAudioPipe } from './audioPipe'
import { buildFfmpegArgs } from './ffmpegArgs'
import { checkNativeCapture, ffmpegPath } from './ffmpegBinary'
import { displayRefreshRate } from './displayRate'

/**
 * The native recorder: one FFmpeg per game, run and watched from here.
 *
 * FFmpeg is started when the game is ready, recording the game's own window
 * (see ffmpegArgs.ts) with the PC's sound and the microphone fed to it over a
 * named pipe (audioPipe.ts) from the audio page (audioCapture.ts). It is
 * stopped with q on its stdin, which makes it close the file cleanly — when
 * asked, or as soon as the game's window closes. The file is already named — it
 * is this module that chose the name — so finishing is only a matter of the
 * process exiting with something written.
 *
 * Everything that touches the machine comes in as a dependency, so the
 * supervision can be tested with a fake process.
 */
const log = createLogger('capture')

/** How long to keep looking for the game's window before giving up on the game. */
const WINDOW_WAIT_MS = 30_000
/** Between looks. FFmpeg says there is no such window in a fraction of a second. */
const WINDOW_RETRY_MS = 2_000
/** A window that is there but shows nothing — minimised, say — for this long is no recording. */
const FIRST_FRAME_MS = 20_000
/** How long FFmpeg gets to close the file after being asked before it is killed. */
const STOP_TIMEOUT_MS = 15_000
/**
 * A killed FFmpeg's file is only worth keeping with at least a fragment in it.
 * Below this it is the header and nothing a player can show.
 */
const MIN_KILLED_BYTES = 512 * 1024

/** What FFmpeg prints when no window matches. */
const NO_WINDOW = /Failed to find capture source/
/** What window capture prints when the window it was capturing goes away. */
const WINDOW_CLOSED = /Capture item closed/

export interface ProcessLike {
  stdin: { write(chunk: Buffer | string): unknown; end(): unknown; on(event: 'error', cb: (err: Error) => void): unknown }
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): unknown }
  stderr: { on(event: 'data', cb: (chunk: Buffer) => void): unknown }
  on(event: 'exit', cb: (code: number | null) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
  kill(): unknown
}

export interface AudioFeedLike {
  onChunk(cb: (samples: Buffer) => void): void
  stop(): void
}

export interface AudioPipeLike {
  path: string
  write(samples: Buffer): void
  close(): void
}

export interface NativeRecorderDeps {
  check(fresh?: boolean): Promise<NativeCaptureCheck>
  ffmpegPath(): string
  spawn(exe: string, args: string[]): ProcessLike
  startAudio(options: CaptureAudioStart): Promise<AudioFeedLike>
  /** A pipe for one launch's audio, by a name unique to it. */
  openAudioPipe(name: string): AudioPipeLike
  fileSize(path: string): number | null
  now(): number
  sleep(ms: number): Promise<void>
  /** The fastest monitor's refresh rate, read as each recording starts. */
  displayHz(): number
}

export interface NativeRecorder extends Recorder {
  /** Probes FFmpeg and the encoders again, and says what it found. */
  recheck(): Promise<NativeCaptureCheck>
}

/** Whether a check means the recorder can record, and if not, what to tell the user. */
export function availability(check: NativeCaptureCheck): RecorderConnection {
  if (check.ffmpeg === 'missing') {
    return { state: 'unavailable', message: "Foxfire's FFmpeg is missing. Reinstall Foxfire to record without OBS." }
  }
  if (check.ffmpeg === 'tooOld') {
    return { state: 'unavailable', message: "Foxfire's FFmpeg is too old to capture a window." }
  }
  if (check.encoder === null) {
    return { state: 'unavailable', message: 'No video encoder worked on this PC.' }
  }
  return { state: 'ready' }
}

/** The highest frame count in a block of FFmpeg's `-progress` output, if it has one. */
export function progressFrames(text: string): number | null {
  let frames: number | null = null
  for (const match of text.matchAll(/^frame=(\d+)\s*$/gm)) {
    frames = Math.max(frames ?? 0, Number(match[1]))
  }
  return frames
}

/** What the `fps` filter says as FFmpeg exits: frames capture delivered, and what it did with them. */
export interface CaptureStats {
  delivered: number
  written: number
  dropped: number
  repeated: number
}

/**
 * Reads the `fps` filter's closing line, e.g. "291 frames in, 121 frames out;
 * 170 frames dropped, 0 frames duplicated."
 *
 * The file always holds exactly the preset's frame rate, so the file alone
 * cannot say whether the game was captured smoothly: half the frames can be
 * repeats and it still plays at 60. This can.
 */
export function captureStats(line: string): CaptureStats | null {
  const match = /(\d+) frames in, (\d+) frames out; (\d+) frames dropped, (\d+) frames duplicated/.exec(line)
  if (!match) return null
  return {
    delivered: Number(match[1]),
    written: Number(match[2]),
    dropped: Number(match[3]),
    repeated: Number(match[4])
  }
}

interface Run {
  child: ProcessLike
  path: string
  launchedAt: number
  frames: number
  /** q has been sent. */
  stopping: boolean
  /** end() has been called for it. */
  asked: boolean
  /** The game's window went away under it, which is what stopped it unless it was asked first. */
  windowClosed: boolean
  stderr: string[]
  /** FFmpeg said no window matched — kept apart from stderr, which only holds the last lines. */
  noWindow: boolean
  stats: CaptureStats | null
  audio: AudioFeedLike | null
  pipe: AudioPipeLike | null
  killTimer: NodeJS.Timeout | null
}

type Attempt = { kind: 'started'; path: string } | { kind: 'noWindow' } | { kind: 'failed'; message: string }

export function createNativeRecorder(deps: NativeRecorderDeps): NativeRecorder {
  let connection: RecorderConnection = { state: 'connecting' }
  let booted = false
  let current: Run | null = null
  /** Bumped by release, so a begin still looking for its window knows it was given up on. */
  let generation = 0
  /**
   * Audio opened while the game loads, for the begin that follows. Opening the
   * page and both devices takes the best part of a second — a second of the
   * game's start, when it waited for begin.
   */
  let warm: { key: string; audio: Promise<AudioFeedLike | null> } | null = null
  /**
   * A file the game's window closing has already finished, held for the end()
   * it belongs to. The window goes a few seconds before the League client says
   * the game is over, and the recording stays the service's to end: reported
   * then, a poll in between would see a game still on and nothing recording it,
   * and start over.
   */
  let heldFile: string | null = null

  function audioOptions(target: RecordTarget): CaptureAudioStart {
    return { mic: target.audio === 'game+mic', micDeviceId: target.micDeviceId }
  }

  /** Which audio a target wants, so a warm feed is only used for the same. */
  function audioKey(target: RecordTarget): string {
    return `${target.audio}|${target.micDeviceId ?? ''}`
  }

  function discardWarm(): void {
    const discarded = warm
    warm = null
    if (discarded) void discarded.audio.then((audio) => audio?.stop())
  }

  /** The warm feed if it is the right one and opened, otherwise a fresh one. */
  async function takeAudio(target: RecordTarget): Promise<AudioFeedLike | null> {
    if (target.audio === 'none') {
      discardWarm()
      return null
    }
    const pending = warm
    if (pending && pending.key === audioKey(target)) {
      warm = null
      const ready = await pending.audio
      if (ready) return ready
    } else {
      discardWarm()
    }
    return deps.startAudio(audioOptions(target))
  }
  const connectionListeners = new Set<() => void>()
  const signalListeners = new Set<(signal: RecorderSignal) => void>()

  function setConnection(next: RecorderConnection): void {
    const same =
      next.state === connection.state &&
      (next.state !== 'unavailable' || (connection.state === 'unavailable' && next.message === connection.message))
    if (same) return
    connection = next
    for (const listener of connectionListeners) listener()
  }

  function emit(signal: RecorderSignal): void {
    for (const listener of signalListeners) listener(signal)
  }

  async function checked(fresh = false): Promise<NativeCaptureCheck> {
    const check = await deps.check(fresh)
    setConnection(availability(check))
    return check
  }

  function remember(run: Run, chunk: Buffer): void {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim() === '') continue
      run.stats = captureStats(line) ?? run.stats
      if (NO_WINDOW.test(line)) run.noWindow = true
      if (WINDOW_CLOSED.test(line)) windowClosed(run)
      run.stderr.push(line)
      if (run.stderr.length > 40) run.stderr.shift()
    }
  }

  /**
   * Asks FFmpeg to finish: stdin is its own keyboard, where q is "stop", and it
   * ends both streams and writes the file out. The audio stops with it, and its
   * pipe is closed now rather than when FFmpeg exits: FFmpeg's thread reading
   * the pipe waits for data or its end, and FFmpeg waits for that thread before
   * it exits — left open, every stop ran out the kill timer.
   */
  function stop(run: Run): void {
    if (run.stopping) return
    run.stopping = true
    run.child.stdin.write('q')
    run.child.stdin.end()
    run.audio?.stop()
    run.pipe?.close()
    run.killTimer = setTimeout(() => {
      log.warn('FFmpeg did not stop in time; killing it', { path: run.path })
      run.child.kill()
    }, STOP_TIMEOUT_MS)
  }

  /**
   * The game's window went away: the footage is over. Left to the end of the
   * game, FFmpeg went on recording the sound over the last frame until the
   * League client said so — three or four seconds after the window, in a game
   * ended from its victory screen.
   */
  function windowClosed(run: Run): void {
    if (current !== run || run.stopping) return
    run.windowClosed = true
    log.info('Game window closed; closing the recording', { path: run.path })
    stop(run)
  }

  /** How smoothly the game was captured, for the log: frames delivered per second, and the share repeated. */
  function smoothness(run: Run): Record<string, number> | null {
    if (!run.stats) return null
    const seconds = Math.max(1, (deps.now() - run.launchedAt) / 1000)
    return {
      capturedPerSecond: Math.round((run.stats.delivered / seconds) * 10) / 10,
      repeatedShare: run.stats.written > 0 ? Math.round((run.stats.repeated / run.stats.written) * 100) / 100 : 0
    }
  }

  function finish(run: Run, code: number | null): void {
    if (run.killTimer) clearTimeout(run.killTimer)
    run.audio?.stop()
    if (current === run) current = null

    const size = deps.fileSize(run.path) ?? 0
    const playable = run.frames > 0 && size > 0 && (code === 0 || size >= MIN_KILLED_BYTES)
    if (playable) {
      log.info('Native recording finished', {
        path: run.path,
        code,
        bytes: size,
        stoppedBy: run.asked ? 'asked' : run.windowClosed ? 'windowClosed' : 'itself',
        ...smoothness(run)
      })
      if (run.windowClosed && !run.asked) {
        heldFile = run.path
        return
      }
      emit({ kind: 'finished', path: run.path })
      return
    }
    log.warn('Native recording ended with nothing playable', { code, bytes: size, stderr: run.stderr.slice(-10) })
    emit({ kind: 'failed', reason: 'FFmpeg stopped without a playable recording.' })
  }

  /** One launch of FFmpeg, settled once it is recording or has given up. */
  function attempt(target: RecordTarget, check: NativeCaptureCheck, audio: AudioFeedLike | null): Promise<Attempt> {
    const launchedAt = deps.now()
    const path = join(target.folder, `pending-${launchedAt}.mp4`)
    // Its own pipe per launch: a retry after a missing window starts afresh.
    const pipe = audio ? deps.openAudioPipe(`foxfire-audio-${process.pid}-${launchedAt}`) : null
    const args = buildFfmpegArgs({
      window: GAME_WINDOWS[target.game],
      quality: captureQualityOption(target.quality),
      // checked() refuses to get this far without one.
      encoder: check.encoder!,
      audioInput: pipe?.path ?? null,
      outputPath: path,
      launchedAt,
      displayHz: deps.displayHz()
    })

    const child = deps.spawn(deps.ffmpegPath(), args)
    const run: Run = {
      child,
      path,
      launchedAt,
      frames: 0,
      stopping: false,
      asked: false,
      windowClosed: false,
      stderr: [],
      noWindow: false,
      stats: null,
      audio,
      pipe,
      killTimer: null
    }

    return new Promise((resolve) => {
      let settled = false
      const settle = (outcome: Attempt): void => {
        if (settled) return
        settled = true
        clearTimeout(firstFrameTimer)
        resolve(outcome)
      }

      const firstFrameTimer = setTimeout(() => {
        settle({ kind: 'failed', message: 'The game window showed nothing to record.' })
        child.kill()
      }, FIRST_FRAME_MS)

      // Writing to an FFmpeg that has just exited is an EPIPE here, and the exit
      // handler below is what deals with the exit.
      child.stdin.on('error', () => undefined)

      child.stdout.on('data', (chunk) => {
        const frames = progressFrames(chunk.toString())
        if (frames !== null) run.frames = Math.max(run.frames, frames)
        if (!settled && run.frames > 0) {
          current = run
          settle({ kind: 'started', path })
          // The file's zero is the launch, near enough — FFmpeg's first packet
          // follows it by the moment it takes to start — not this signal, which
          // waits on the encoder's first output.
          emit({ kind: 'started', at: launchedAt })
        }
      })
      child.stderr.on('data', (chunk) => remember(run, chunk))

      child.on('error', (err) => {
        settle({ kind: 'failed', message: `FFmpeg would not start: ${err.message}` })
      })

      child.on('exit', (code) => {
        pipe?.close()
        if (!settled) {
          if (!run.noWindow) log.warn('FFmpeg exited before recording', { code, stderr: run.stderr.slice(-10) })
          settle(
            run.noWindow
              ? { kind: 'noWindow' }
              : { kind: 'failed', message: run.stderr.at(-1) ?? `FFmpeg exited with ${code}.` }
          )
          return
        }
        finish(run, code)
      })

      audio?.onChunk((samples) => {
        if (!run.stopping) pipe?.write(samples)
      })
    })
  }

  const recorder: NativeRecorder = {
    driver: 'native',

    boot() {
      if (booted) return
      booted = true
      // The probe opens every encoder in turn, a second or two, so it is done
      // now rather than when a game is already loading.
      void checked().catch((err) => log.warn('Native capture check failed', { error: String(err) }))
    },

    async shutdown() {
      booted = false
      discardWarm()
      if (current) await recorder.end()
    },

    connection: () => connection,

    onConnectionChange(cb) {
      connectionListeners.add(cb)
    },

    onSignal(cb) {
      signalListeners.add(cb)
    },

    async prepare(target) {
      if (current || target.audio === 'none') return
      if (warm && warm.key === audioKey(target)) return
      discardWarm()
      // Samples arrive from now on and go nowhere until FFmpeg is there to take them.
      const audio = deps.startAudio(audioOptions(target)).catch((err: unknown) => {
        log.debug('Could not open audio ahead of the game', { error: String(err) })
        return null
      })
      warm = { key: audioKey(target), audio }
      await audio
    },

    async begin(target) {
      if (current) throw new Error('Already recording')
      const mine = ++generation

      const check = await checked()
      if (connection.state !== 'ready') {
        throw new Error(connection.state === 'unavailable' ? connection.message : 'Native capture is not ready.')
      }

      const audio = await takeAudio(target)

      try {
        const deadline = deps.now() + WINDOW_WAIT_MS
        for (;;) {
          const outcome = await attempt(target, check, audio)
          if (mine !== generation) {
            // Released while it was starting: nobody is waiting for this
            // recording any more, so one that did start is stopped again.
            if (outcome.kind === 'started') await recorder.end()
            throw new Error('The recording was given up on before it started.')
          }
          if (outcome.kind === 'started') {
            log.info('Native recording started', { game: target.game, encoder: check.encoder, path: outcome.path })
            return
          }
          if (outcome.kind === 'noWindow' && deps.now() < deadline) {
            await deps.sleep(WINDOW_RETRY_MS)
            continue
          }
          throw new Error(
            outcome.kind === 'noWindow' ? 'The game window never appeared.' : outcome.message
          )
        }
      } catch (err) {
        audio?.stop()
        throw err
      }
    },

    async end() {
      if (heldFile !== null) {
        const path = heldFile
        heldFile = null
        // Once the caller has the path, as OBS's own stop event arrives after
        // its reply: the service keeps the reply and finishes on the signal.
        setImmediate(() => emit({ kind: 'finished', path }))
        return path
      }
      const run = current
      if (!run) return null
      run.asked = true
      stop(run)
      return run.path
    },

    async release() {
      // Nothing outside the file was changed — but a recording given up on
      // must not go on without anybody listening: a start still looking for
      // its window is called off, and one already running is stopped. After a
      // recording that finished, there is neither.
      generation += 1
      discardWarm()
      heldFile = null
      if (current && !current.stopping) await recorder.end()
    },

    outputPath: () => current?.path ?? heldFile,

    recheck: () => checked(true)
  }

  return recorder
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

/** The recorder the app runs. */
export const nativeRecorder = createNativeRecorder({
  check: checkNativeCapture,
  ffmpegPath,
  spawn: (exe, args) => spawnProcess(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }),
  startAudio: startAudioCapture,
  openAudioPipe,
  fileSize,
  displayHz: displayRefreshRate,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
})
