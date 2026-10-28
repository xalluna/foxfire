import {
  DISPLAY_PRESET_REFERENCE_HZ,
  presetFps,
  type CaptureQualityOption
} from '@shared/captureQuality'
import type { NativeEncoder } from '@shared/types'
import type { GameWindow } from '../gameWindows'

/**
 * The FFmpeg command line for one recording. Pure, so every choice in it can be
 * read in a test rather than discovered in a game.
 *
 * Video is `gfxcapture`: Windows Graphics Capture of the game's own window,
 * matched by executable and class. It is the window rather than the screen, so
 * whatever covers the game — a browser alt-tabbed to, a notification — never
 * reaches the file. Frames arrive as D3D11 textures and are scaled to the
 * quality preset there, on the GPU, keeping the game's aspect.
 *
 * Audio, when there is any, is not FFmpeg's: it has no way to capture what the
 * PC plays on Windows. It arrives on a named pipe (audioPipe.ts) as raw 48 kHz
 * stereo float from the capture page (audioCapture.ts), which mixes the PC's
 * output with the microphone. stdin is kept for the q that stops FFmpeg.
 *
 * The two never share a filtergraph. FFmpeg runs a graph as one, asking it for
 * whichever of its outputs is furthest behind — with live audio, nearly always
 * the audio — so with both in one graph capture was asked for a frame only as
 * audio came in: about 60 a second from a 144 Hz game, a third of the file
 * repeats. The capture is the complex graph on its own; the audio is filtered
 * on its way to the encoder (`-af`).
 *
 * They meet on one clock instead, the wall clock:
 *
 * - Audio is stamped with the moment FFmpeg read it (use_wallclock_as_timestamps).
 * - Video keeps the capture's own frame times, moved onto the wall clock (the
 *   setpts below), then evened out to the preset's frame rate.
 * - `-copyts` keeps both as they are, `-output_ts_offset` moves the launch to
 *   zero, and `avoid_negative_ts make_zero` shifts the whole file so its first
 *   packet is at 0 — the same shift for both, so they stay together.
 *
 * Starting both at "zero" instead, which is what FFmpeg does by default, puts
 * the audio ahead by however long window capture took to deliver a first frame.
 * aresample's `async` absorbs the slow drift between the sound card's clock and
 * the system's over a long game, and ignores the jitter of a pipe.
 *
 * The file is fragmented MP4: playable by Chromium (recordingProtocol serves
 * nothing else), and playable even if FFmpeg is killed or the PC loses power
 * mid-game, because there is no index to write at the end. H.264 because every
 * GPU encodes it and every player decodes it, YouTube included.
 */

export interface FfmpegArgsInput {
  window: GameWindow
  quality: Pick<CaptureQualityOption, 'width' | 'height' | 'fps' | 'approxGbPerHour'>
  encoder: NativeEncoder
  /** The named pipe the audio arrives on (see audioPipe.ts), or null for none. */
  audioInput: string | null
  outputPath: string
  /** The wall clock at launch, in milliseconds — what the file's zero means. */
  launchedAt: number
  /** The fastest monitor's refresh rate, which a 'display' preset records at. */
  displayHz: number
}

/** The frame rate this recording comes out at. */
export function outputFps(input: Pick<FfmpegArgsInput, 'quality' | 'displayHz'>): number {
  return presetFps(input.quality, input.displayHz)
}

/** Audio as the capture page sends it. */
export const AUDIO_SAMPLE_RATE = 48_000
export const AUDIO_CHANNELS = 2

/** A keyframe every two seconds: seeking lands within two seconds, and so does a crash's loss. */
const KEYFRAME_SECONDS = 2

/**
 * How often window capture may deliver a frame — well above the rate recorded.
 *
 * Windows hands over a captured frame only on a display refresh, and never
 * sooner than this allows. Capped at the preset's own 60, a 144 Hz monitor
 * waits three refreshes for every frame — 48 fps at best, and 25 to 38 in a
 * real game, which is what the first native recording came out at. Uncapped,
 * capture follows the display, and the `fps` filter after it takes exactly the
 * rate recorded from that. Twice the rate recorded, or 240, whichever is more.
 */
const CAPTURE_CEILING_FPS = 240

function captureCeiling(fps: number): number {
  return Math.max(CAPTURE_CEILING_FPS, fps * 2)
}

const AUDIO_BITRATE = '160k'

/**
 * Quotes a value for a filter's option list.
 *
 * A filter option is parsed out of `key=value:key=value`, where `:` and `\`
 * mean something; single quotes make everything inside literal, and a quote
 * itself is written by closing, escaping and reopening.
 */
export function quoteOption(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * Escapes a filter's whole argument string for the filtergraph around it.
 *
 * The graph is parsed first, with its own special characters — `[],;` and the
 * same quoting — and strips one level of escaping before the filter sees its
 * options. Without this, the option-level quotes above are eaten by the graph.
 */
export function escapeForGraph(args: string): string {
  return args.replace(/[\\'[\],;]/g, (c) => `\\${c}`)
}

/** An exact, case-insensitive match on a name, as an ECMAScript regex. */
export function exactName(name: string): string {
  return `(?i)^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
}

function filter(name: string, options: Array<[string, string | number]>): string {
  const args = options.map(([key, value]) => `${key}=${value}`).join(':')
  return `${name}=${escapeForGraph(args)}`
}

/**
 * Bits per second for a preset, so a native recording costs about what the
 * settings screen says it will (approxGbPerHour, measured against OBS).
 *
 * A preset that follows the display quotes its figure at 144 Hz, and is scaled
 * from there by less than the frame count: frames closer together differ less,
 * and cost less each. At 60 Hz it comes out near the 60 fps preset of its size.
 */
export function videoBitrate(
  quality: Pick<CaptureQualityOption, 'approxGbPerHour' | 'fps'>,
  fps: number
): number {
  const scale = quality.fps === 'display' ? (fps / DISPLAY_PRESET_REFERENCE_HZ) ** 0.7 : 1
  const bytesPerHour = quality.approxGbPerHour * 1e9 * scale
  const audioBitsPerSecond = 160_000
  return Math.round((bytesPerHour * 8) / 3600 - audioBitsPerSecond)
}

/**
 * Whether the encoder takes the capture's GPU frames as they are.
 *
 * Only NVENC, the one tested end to end: it reads the BGRA textures straight
 * off the GPU and converts them itself. The rest are given frames converted on
 * the CPU — FFmpeg's D3D11 scaler will not take gfxcapture's textures — which
 * costs a copy back from the GPU but is right on any hardware.
 */
export function takesGpuFrames(encoder: NativeEncoder): boolean {
  return encoder === 'nvenc'
}

function captureFilter(input: FfmpegArgsInput): string {
  const { window, quality } = input
  return filter('gfxcapture', [
    ['window_exe', quoteOption(exactName(window.exe))],
    ['window_class', quoteOption(exactName(window.windowClass))],
    ['max_framerate', captureCeiling(outputFps(input))],
    ['width', quality.width],
    ['height', quality.height],
    // Letterboxed rather than stretched when the game's aspect is not the
    // preset's — an ultrawide game stays the right shape.
    ['resize_mode', 'scale_aspect'],
    ['capture_cursor', 1]
  ])
}

/**
 * The capture's own frame times, moved onto the wall clock. RTCTIME is
 * microseconds; gfxcapture's time base is 100 ns, counted from its first frame.
 *
 * The offset between the two clocks is the smallest gap yet seen between a
 * frame's capture time and the moment it came through here, kept in st(0): a
 * frame that arrives promptly says where the clocks stand, and one held up
 * behind the encoder cannot drag the picture late.
 *
 * Not the wall clock as each frame passes, which is what this was for a while.
 * Frames reach here in clumps whenever anything downstream holds them up — the
 * audio did, when it shared the capture's graph — and a clump captured a few
 * milliseconds apart came out stamped with one moment, so the `fps` filter
 * kept one of each.
 */
const WALL_CLOCK_PTS = filter('setpts', [
  [
    'expr',
    quoteOption(
      'PTS+st(0,if(eq(N,0),RTCTIME/(TB*1000000)-PTS,min(ld(0),RTCTIME/(TB*1000000)-PTS)))'
    )
  ]
])

/**
 * What the frames are once they reach the encoder, written onto them so the
 * file says so.
 *
 * NVENC converts BGRA with the BT.601 matrix into limited range — measured, by
 * encoding a known colour and decoding it both ways — and FFmpeg otherwise
 * labels the result with the RGB input's own colour properties, which a player
 * that believes them renders in the wrong colours. The CPU conversion below is
 * BT.709, and labelled to match.
 */
function colourTags(colorspace: 'bt470bg' | 'bt709'): string {
  return filter('setparams', [
    ['colorspace', colorspace],
    ['range', 'tv'],
    ['color_primaries', 'bt709'],
    ['color_trc', 'bt709']
  ])
}

export function videoChain(input: FfmpegArgsInput): string {
  // The preset's frame rate, taken from however many the display gave — and
  // before anything is copied off the GPU, so a dropped frame costs nothing.
  const head = [captureFilter(input), WALL_CLOCK_PTS, `fps=${outputFps(input)}`]
  if (takesGpuFrames(input.encoder)) return [...head, colourTags('bt470bg')].join(',')
  return [
    ...head,
    'hwdownload',
    'format=bgra',
    filter('scale', [
      ['out_color_matrix', 'bt709'],
      ['out_range', 'tv']
    ]),
    'format=nv12',
    colourTags('bt709')
  ].join(',')
}

/**
 * Each GPU encoder hands a frame back as soon as it is encoded, rather than
 * queueing them — NVENC holds up to its whole surface pool by default, AMF 16
 * frames, QSV 4 — and reorders none (no B-frames).
 *
 * FFmpeg pauses an input that gets more than 100 ms ahead of the slowest stream
 * reaching the file, and the slowest is the video, by however long the encoder
 * keeps it. Paused, the audio piles up in its pipe, and is then read in a rush,
 * every packet stamped with the moment it was read: the audio sees time stand
 * still and then jump, and is cut and padded to match. Through NVENC's default
 * queue that was a tenth of a second of silence every third of a second —
 * measured, with the audio going in whole. Windows' own encoders keep no such
 * queue. AMF's and QSV's settings are by their documentation; no AMD or Intel
 * GPU has recorded through them yet.
 */
function encoderArgs(input: FfmpegArgsInput): string[] {
  const fps = outputFps(input)
  const bitrate = videoBitrate(input.quality, fps)
  const rate = [
    '-b:v',
    String(bitrate),
    '-maxrate',
    String(Math.round(bitrate * 1.5)),
    '-bufsize',
    String(bitrate * 2)
  ]
  const gop = ['-g', String(fps * KEYFRAME_SECONDS)]

  switch (input.encoder) {
    case 'nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', ...rate, ...gop, '-profile:v', 'high', '-delay', '0', '-bf', '0']
    case 'amf':
      return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'balanced', '-rc', 'vbr_peak', ...rate, ...gop, '-profile:v', 'high', '-async_depth', '1', '-latency', '1', '-bf', '0']
    case 'qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', ...rate, ...gop, '-profile:v', 'high', '-async_depth', '1', '-bf', '0']
    case 'mf-hw':
      return ['-c:v', 'h264_mf', '-hw_encoding', '1', '-b:v', String(bitrate), ...gop]
    case 'mf':
      return ['-c:v', 'h264_mf', '-b:v', String(bitrate), ...gop]
  }
}

export function buildFfmpegArgs(input: FfmpegArgsInput): string[] {
  const args = [
    '-hide_banner',
    // Verbose for one line it prints as it exits: how many frames capture
    // delivered to the `fps` filter and how many it had to repeat — the only
    // way to tell from the log whether a recording really had every frame,
    // since the file always has exactly the preset's rate. See captureStats.
    '-loglevel',
    'verbose',
    '-nostats',
    // Progress on stdout, one block every half second: the first frame counted
    // there is what says the recording has started.
    '-progress',
    'pipe:1',
    '-stats_period',
    '0.5',
    '-y'
  ]

  if (input.audioInput) {
    args.push(
      '-thread_queue_size',
      '4096',
      '-f',
      'f32le',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      String(AUDIO_CHANNELS),
      '-use_wallclock_as_timestamps',
      '1',
      '-i',
      input.audioInput
    )
  }

  // The capture alone in the complex graph: see the top of this file for what
  // putting the audio in it as well did.
  args.push('-filter_complex', `${videoChain(input)}[v]`, '-map', '[v]')
  if (input.audioInput) args.push('-map', '0:a')

  args.push(...encoderArgs(input))
  if (input.audioInput) {
    args.push('-af', filter('aresample', [['async', 1]]), '-c:a', 'aac', '-b:a', AUDIO_BITRATE)
  }

  // No -shortest: a recording is stopped with q on stdin, which ends both
  // streams at once, rather than by ending the audio and the video with it.
  args.push(
    '-copyts',
    '-output_ts_offset',
    String(-input.launchedAt / 1000),
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    input.outputPath
  )

  return args
}
