import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeCaptureCheck } from '@shared/types'
import type { RecorderSignal, RecordTarget } from '../recorder'
import {
  availability,
  captureStats,
  createNativeRecorder,
  progressFrames,
  type AudioFeedLike,
  type NativeRecorderDeps,
  type ProcessLike
} from './nativeRecorder'

/**
 * The supervision of FFmpeg, with a fake process in its place: when a recording
 * counts as started, how it is stopped, what a game window that is not there yet
 * does, and what an FFmpeg that dies leaves behind. The command line itself is
 * ffmpegArgs.test.ts's.
 */

vi.mock('../../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} })
}))
// Both reach for Electron; the recorder under test is given fakes instead.
vi.mock('./audioCapture', () => ({ startAudioCapture: () => Promise.reject(new Error('unused')) }))
vi.mock('./ffmpegBinary', () => ({
  checkNativeCapture: () => Promise.reject(new Error('unused')),
  ffmpegPath: () => 'unused'
}))

const READY: NativeCaptureCheck = {
  ffmpeg: 'ok',
  version: 'n9.0.2',
  encoder: 'nvenc',
  encoders: ['nvenc', 'mf'],
  displayHz: 144
}

class FakeProcess extends EventEmitter implements ProcessLike {
  written: Array<Buffer | string> = []
  ended = false
  killed = false
  stdin = {
    write: (chunk: Buffer | string) => this.written.push(chunk),
    end: () => {
      this.ended = true
    },
    on: () => undefined
  }
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  progress(frames: number): void {
    this.stdout.emit('data', Buffer.from(`frame=${frames}\nfps=60.0\nprogress=continue\n`))
  }

  say(line: string): void {
    this.stderr.emit('data', Buffer.from(`${line}\n`))
  }

  exit(code: number | null): void {
    this.emit('exit', code)
  }

  kill(): void {
    this.killed = true
  }
}

class FakeAudio implements AudioFeedLike {
  listener: ((samples: Buffer) => void) | null = null
  stopped = false
  onChunk(cb: (samples: Buffer) => void): void {
    this.listener = cb
  }
  stop(): void {
    this.stopped = true
  }
}

const TARGET: RecordTarget = {
  game: 'lol',
  folder: 'D:\\Recordings',
  quality: '1080p60',
  audio: 'game+mic',
  micDeviceId: 'mic-1'
}

let clock = 0
let processes: FakeProcess[] = []
let audio: FakeAudio
let sizes: Record<string, number | null> = {}
let check: NativeCaptureCheck = READY
let signals: RecorderSignal[] = []
let deps: NativeRecorderDeps
let sleeps: number[] = []

/** The audio pipe each launch opened: what it was sent, and whether it was closed. */
class FakePipe {
  received: Buffer[] = []
  closed = false
  constructor(readonly path: string) {}
  write(samples: Buffer): void {
    this.received.push(samples)
  }
  close(): void {
    this.closed = true
  }
}
let pipes: FakePipe[] = []

function recorder() {
  const made = createNativeRecorder(deps)
  made.onSignal((signal) => signals.push(signal))
  return made
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

beforeEach(() => {
  clock = 1_000
  processes = []
  audio = new FakeAudio()
  sizes = {}
  check = READY
  signals = []
  sleeps = []
  pipes = []
  deps = {
    check: () => Promise.resolve(check),
    ffmpegPath: () => 'C:\\Foxfire\\resources\\ffmpeg\\ffmpeg.exe',
    spawn: () => {
      const child = new FakeProcess()
      processes.push(child)
      return child
    },
    startAudio: vi.fn(() => Promise.resolve(audio)),
    openAudioPipe: (name) => {
      const pipe = new FakePipe(`\\\\.\\pipe\\${name}`)
      pipes.push(pipe)
      return pipe
    },
    fileSize: (path) => sizes[path] ?? null,
    now: () => clock,
    displayHz: () => 144,
    sleep: (ms) => {
      sleeps.push(ms)
      clock += ms
      return Promise.resolve()
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('starting a native recording', () => {
  it('counts as started on the first frame FFmpeg reports, timed from its launch', async () => {
    const native = recorder()
    const begun = native.begin(TARGET)
    await flush()

    const [child] = processes
    child!.progress(0)
    await flush()
    expect(signals).toEqual([])

    clock = 1_400
    child!.progress(3)
    await begun

    expect(signals).toEqual([{ kind: 'started', at: 1_000 }])
    expect(native.outputPath()).toBe('D:\\Recordings\\pending-1000.mp4')
    expect(deps.startAudio).toHaveBeenCalledWith({ mic: true, micDeviceId: 'mic-1' })
  })

  it("records a display preset at the monitor's rate, read as the game starts", async () => {
    const spawned: string[][] = []
    deps.spawn = (_exe, args) => {
      spawned.push(args)
      const child = new FakeProcess()
      processes.push(child)
      return child
    }
    const native = recorder()
    const begun = native.begin({ ...TARGET, quality: '1440pDisplay' })
    await flush()
    processes[0]!.progress(1)
    await begun

    expect(spawned[0]!.join(' ')).toContain(',fps=144,')
  })

  it('starts with the audio opened while the game loaded, rather than opening it then', async () => {
    const native = recorder()
    await native.prepare(TARGET)
    expect(deps.startAudio).toHaveBeenCalledTimes(1)

    const begun = native.begin(TARGET)
    await flush()
    processes[0]!.progress(1)
    await begun

    expect(deps.startAudio).toHaveBeenCalledTimes(1)
    audio.listener!(Buffer.from([9]))
    expect(pipes[0]!.received).toEqual([Buffer.from([9])])
  })

  it('opens fresh audio when the microphone changed during loading', async () => {
    const native = recorder()
    const first = audio
    await native.prepare(TARGET)
    audio = new FakeAudio()

    const begun = native.begin({ ...TARGET, micDeviceId: 'mic-2' })
    await flush()
    processes[0]!.progress(1)
    await begun

    expect(deps.startAudio).toHaveBeenCalledTimes(2)
    expect(first.stopped).toBe(true)
  })

  it('closes audio opened for a game that never started', async () => {
    const native = recorder()
    await native.prepare(TARGET)

    await native.release()
    await flush()

    expect(audio.stopped).toBe(true)
    expect(processes).toEqual([])
  })

  it("feeds the audio page's samples to FFmpeg over a pipe of their own, keeping stdin free", async () => {
    const spawned: string[][] = []
    deps.spawn = (_exe, args) => {
      spawned.push(args)
      const child = new FakeProcess()
      processes.push(child)
      return child
    }
    const native = recorder()
    const begun = native.begin(TARGET)
    await flush()
    processes[0]!.progress(1)
    await begun

    audio.listener!(Buffer.from([1, 2, 3, 4]))
    expect(pipes[0]!.received).toEqual([Buffer.from([1, 2, 3, 4])])
    expect(processes[0]!.written).toEqual([])
    expect(spawned[0]).toContain(pipes[0]!.path)
    expect(pipes[0]!.path).toBe('\\\\.\\pipe\\foxfire-audio-' + process.pid + '-1000')
  })

  it('opens a new pipe for each launch while it looks for the window', async () => {
    const native = recorder()
    const begun = native.begin(TARGET)
    await flush()
    processes[0]!.say('Failed to find capture source')
    processes[0]!.exit(1)
    await flush()
    processes[1]!.progress(1)
    await begun

    expect(pipes).toHaveLength(2)
    expect(pipes[0]!.closed).toBe(true)
    expect(pipes[1]!.closed).toBe(false)
  })

  it('looks for the game window again until it appears', async () => {
    const native = recorder()
    const begun = native.begin({ ...TARGET, game: 'tft' })
    await flush()

    processes[0]!.say('[Parsed_gfxcapture_0 @ 0000] Failed to find capture source')
    processes[0]!.exit(1)
    await flush()
    expect(sleeps).toEqual([2_000])

    processes[1]!.progress(1)
    await begun
    expect(signals).toEqual([{ kind: 'started', at: 3_000 }])
  })

  it('gives up on a window that never appears, and lets the audio go', async () => {
    const native = recorder()
    const begun = native.begin(TARGET)
    const outcome = begun.then(
      () => 'resolved',
      (err: Error) => err.message
    )

    // Every launch finds no window, two seconds apart, until thirty have passed.
    for (let i = 0; i < 20; i += 1) {
      await flush()
      const child = processes[i]
      if (!child) break
      child.say('Failed to find capture source')
      child.exit(1)
      await flush()
    }

    expect(await outcome).toBe('The game window never appeared.')
    expect(processes).toHaveLength(16)
    expect(audio.stopped).toBe(true)
    expect(signals).toEqual([])
  })

  it('refuses at once, with the reason, when this PC cannot record', async () => {
    check = { ffmpeg: 'missing', version: null, encoder: null, encoders: [], displayHz: 144 }
    const native = recorder()

    await expect(native.begin(TARGET)).rejects.toThrow("Foxfire's FFmpeg is missing")
    expect(processes).toEqual([])
    expect(native.connection()).toMatchObject({ state: 'unavailable' })
  })

  it('reports what FFmpeg said when it fails for any other reason', async () => {
    const native = recorder()
    const begun = native.begin(TARGET)
    await flush()

    processes[0]!.say('[h264_nvenc @ 0000] OpenEncodeSessionEx failed: out of memory (10)')
    processes[0]!.exit(1)

    await expect(begun).rejects.toThrow('OpenEncodeSessionEx failed')
    expect(audio.stopped).toBe(true)
  })

  it('calls off a start that is given up on while it looks for the window', async () => {
    const native = recorder()
    const begun = native.begin(TARGET)
    const outcome = begun.then(
      () => 'resolved',
      (err: Error) => err.message
    )
    await flush()

    // The game went away while FFmpeg was still looking for its window.
    await native.release()
    processes[0]!.say('Failed to find capture source')
    processes[0]!.exit(1)

    expect(await outcome).toBe('The recording was given up on before it started.')
    expect(processes).toHaveLength(1)
    expect(audio.stopped).toBe(true)
  })

  it('stops a recording that started after it was given up on', async () => {
    const native = recorder()
    const begun = native.begin(TARGET).catch(() => undefined)
    await flush()

    await native.release()
    processes[0]!.progress(1)
    await begun

    expect(processes[0]!.ended).toBe(true)
    expect(audio.stopped).toBe(true)
  })

  it('records video alone without asking for audio', async () => {
    const native = recorder()
    const begun = native.begin({ ...TARGET, audio: 'none' })
    await flush()
    processes[0]!.progress(1)
    await begun

    expect(deps.startAudio).not.toHaveBeenCalled()
  })
})

describe('stopping a native recording', () => {
  async function recording() {
    const native = recorder()
    const begun = native.begin(TARGET)
    await flush()
    processes[0]!.progress(30)
    await begun
    signals = []
    return { native, child: processes[0]! }
  }

  it("asks FFmpeg to stop with q on its stdin, and ends the audio", async () => {
    const { native, child } = await recording()

    expect(await native.end()).toBe('D:\\Recordings\\pending-1000.mp4')
    expect(child.written).toEqual(['q'])
    expect(child.ended).toBe(true)
    expect(audio.stopped).toBe(true)
    // Left open, FFmpeg sits on a read of it and never gets round to the q.
    expect(pipes[0]!.closed).toBe(true)
  })

  it('finishes with the file once FFmpeg has written it out', async () => {
    const { native, child } = await recording()
    await native.end()

    sizes['D:\\Recordings\\pending-1000.mp4'] = 40_000_000
    child.exit(0)

    expect(signals).toEqual([{ kind: 'finished', path: 'D:\\Recordings\\pending-1000.mp4' }])
    expect(native.outputPath()).toBeNull()
    expect(pipes[0]!.closed).toBe(true)
  })

  it('asks with q when there is no audio to end', async () => {
    const native = recorder()
    const begun = native.begin({ ...TARGET, audio: 'none' })
    await flush()
    processes[0]!.progress(1)
    await begun

    await native.end()
    expect(processes[0]!.written).toEqual(['q'])
    expect(processes[0]!.ended).toBe(true)
  })

  it('kills an FFmpeg that does not stop in time', async () => {
    vi.useFakeTimers()
    const { native, child } = await recording()
    await native.end()

    vi.advanceTimersByTime(14_999)
    expect(child.killed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(child.killed).toBe(true)
  })

  it('finishes when FFmpeg exits on its own', async () => {
    const { native, child } = await recording()

    sizes['D:\\Recordings\\pending-1000.mp4'] = 900_000_000
    child.exit(0)

    expect(signals).toEqual([{ kind: 'finished', path: 'D:\\Recordings\\pending-1000.mp4' }])
    expect(audio.stopped).toBe(true)
    expect(native.outputPath()).toBeNull()
  })

  it('closes the file as the game window closes, rather than recording sound over its last frame', async () => {
    const { native, child } = await recording()

    child.say('[Parsed_gfxcapture_0 @ 0000014f4129c5c0] Capture item closed')

    expect(child.written).toEqual(['q'])
    expect(audio.stopped).toBe(true)
    expect(pipes[0]!.closed).toBe(true)
    expect(native.outputPath()).toBe('D:\\Recordings\\pending-1000.mp4')
  })

  it('holds a file the window closed until the recording is ended, and hands it over then', async () => {
    const { native, child } = await recording()
    child.say('[Parsed_gfxcapture_0 @ 0000014f4129c5c0] Capture item closed')
    sizes['D:\\Recordings\\pending-1000.mp4'] = 40_000_000
    child.exit(0)

    // The League client still says the game is on: reported now, a poll would
    // find a game with nothing recording it and start again.
    expect(signals).toEqual([])
    expect(native.outputPath()).toBe('D:\\Recordings\\pending-1000.mp4')

    expect(await native.end()).toBe('D:\\Recordings\\pending-1000.mp4')
    // After the caller has the path, as OBS's stop event follows its reply.
    expect(signals).toEqual([])
    await new Promise((resolve) => setImmediate(resolve))
    expect(signals).toEqual([{ kind: 'finished', path: 'D:\\Recordings\\pending-1000.mp4' }])
    expect(child.written).toEqual(['q'])
    expect(native.outputPath()).toBeNull()
  })

  it('finishes at once when asked while FFmpeg is still writing out after the window closed', async () => {
    const { native, child } = await recording()
    child.say('[Parsed_gfxcapture_0 @ 0000014f4129c5c0] Capture item closed')

    expect(await native.end()).toBe('D:\\Recordings\\pending-1000.mp4')
    sizes['D:\\Recordings\\pending-1000.mp4'] = 40_000_000
    child.exit(0)

    expect(signals).toEqual([{ kind: 'finished', path: 'D:\\Recordings\\pending-1000.mp4' }])
    expect(child.written).toEqual(['q'])
  })

  it('lets go of a file the window closed when the recording is given up on', async () => {
    const { native, child } = await recording()
    child.say('[Parsed_gfxcapture_0 @ 0000014f4129c5c0] Capture item closed')
    sizes['D:\\Recordings\\pending-1000.mp4'] = 40_000_000
    child.exit(0)

    await native.release()

    expect(native.outputPath()).toBeNull()
    expect(await native.end()).toBeNull()
    await new Promise((resolve) => setImmediate(resolve))
    expect(signals).toEqual([])
  })

  it('keeps what a crashed FFmpeg wrote, once there is a fragment in it', async () => {
    const { child } = await recording()

    sizes['D:\\Recordings\\pending-1000.mp4'] = 6_000_000
    child.exit(3_221_225_477)

    expect(signals).toEqual([{ kind: 'finished', path: 'D:\\Recordings\\pending-1000.mp4' }])
  })

  it('fails a crash that left only the header behind', async () => {
    const { child } = await recording()

    sizes['D:\\Recordings\\pending-1000.mp4'] = 1_200
    child.exit(1)

    expect(signals).toEqual([{ kind: 'failed', reason: 'FFmpeg stopped without a playable recording.' }])
  })
})

describe('whether the native recorder can record', () => {
  it('is ready with FFmpeg and a working encoder', () => {
    expect(availability(READY)).toEqual({ state: 'ready' })
  })

  it('says what is missing otherwise', () => {
    expect(availability({ ffmpeg: 'tooOld', version: 'n8.0', encoder: null, encoders: [], displayHz: 144 })).toEqual({
      state: 'unavailable',
      message: "Foxfire's FFmpeg is too old to capture a window."
    })
    expect(availability({ ffmpeg: 'ok', version: 'n9.0', encoder: null, encoders: [], displayHz: 144 })).toEqual({
      state: 'unavailable',
      message: 'No video encoder worked on this PC.'
    })
  })

  it('is checked when booted, and the change announced', async () => {
    const native = recorder()
    const changes: string[] = []
    native.onConnectionChange(() => changes.push(native.connection().state))

    expect(native.connection()).toEqual({ state: 'connecting' })
    native.boot()
    await flush()

    expect(changes).toEqual(['ready'])
  })
})

describe('how smoothly a game was captured', () => {
  it("is read off the fps filter's closing line", () => {
    expect(
      captureStats('[Parsed_fps_2 @ 000001] 8712 frames in, 8790 frames out; 0 frames dropped, 4398 frames duplicated.')
    ).toEqual({ delivered: 8712, written: 8790, dropped: 0, repeated: 4398 })
  })

  it('is nothing on any other line', () => {
    expect(captureStats('[Parsed_fps_2 @ 000001] fps=60/1')).toBeNull()
  })
})

describe("FFmpeg's progress", () => {
  it('is read for its frame count', () => {
    expect(progressFrames('frame=0\nfps=0.00\nprogress=continue\n')).toBe(0)
    expect(progressFrames('frame=12\nprogress=continue\nframe=40\nprogress=continue\n')).toBe(40)
    expect(progressFrames('fps=60\nprogress=continue\n')).toBeNull()
  })
})
