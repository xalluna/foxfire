import { describe, expect, it } from 'vitest'
import { captureQualityOption } from '@shared/captureQuality'
import { GAME_WINDOWS } from '../gameWindows'
import {
  buildFfmpegArgs,
  escapeForGraph,
  exactName,
  quoteOption,
  videoBitrate,
  videoChain,
  type FfmpegArgsInput
} from './ffmpegArgs'

const LAUNCHED_AT = 1_793_131_716_703
const PIPE = '\\\\.\\pipe\\foxfire-audio-1234-1793131716703'

function input(patch: Partial<FfmpegArgsInput> = {}): FfmpegArgsInput {
  return {
    window: GAME_WINDOWS.lol,
    quality: captureQualityOption('1080p60'),
    encoder: 'nvenc',
    audioInput: PIPE,
    outputPath: 'D:\\My Videos\\Foxfire\\pending-1.mp4',
    launchedAt: LAUNCHED_AT,
    displayHz: 144,
    ...patch
  }
}

function after(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/**
 * FFmpeg's av_get_token: reads up to an unquoted, unescaped terminator,
 * dropping one level of quotes and backslashes. What both levels of filtergraph
 * parsing run, so the escaping can be checked against what FFmpeg would see.
 */
function getToken(text: string, terminators: string): [string, string] {
  let out = ''
  let i = 0
  while (i < text.length && !terminators.includes(text[i]!)) {
    const c = text[i]!
    if (c === '\\' && i + 1 < text.length) {
      out += text[i + 1]
      i += 2
    } else if (c === "'") {
      const close = text.indexOf("'", i + 1)
      out += text.slice(i + 1, close === -1 ? undefined : close)
      i = close === -1 ? text.length : close + 1
    } else {
      out += c
      i += 1
    }
  }
  return [out, text.slice(i)]
}

/** A filter's options as FFmpeg would read them out of a filtergraph. */
function parseFilter(graph: string): { name: string; options: Record<string, string> } {
  const [name, rest] = getToken(graph, '=,;[')
  let [args] = getToken(rest.slice(1), '[],;')
  const options: Record<string, string> = {}
  while (args.length > 0) {
    const [key, afterKey] = getToken(args, '=:')
    const [value, afterValue] = getToken(afterKey.slice(1), ':')
    options[key] = value
    args = afterValue.slice(1)
  }
  return { name, options }
}

describe('the FFmpeg command line', () => {
  it("captures the game's own window, matched by its executable and class", () => {
    const { name, options } = parseFilter(videoChain(input()))

    expect(name).toBe('gfxcapture')
    expect(options.window_exe).toBe('(?i)^League of Legends\\.exe$')
    expect(options.window_class).toBe('(?i)^RiotWindowClass$')
  })

  it("finds TFT's window by its own program", () => {
    const { options } = parseFilter(videoChain(input({ window: GAME_WINDOWS.tft })))

    expect(options.window_exe).toBe('(?i)^TFTClient-Win64-Shipping\\.exe$')
    expect(options.window_class).toBe('(?i)^UnrealWindow$')
  })

  it("scales to the preset on the GPU, keeping the game's shape", () => {
    const { options } = parseFilter(videoChain(input({ quality: captureQualityOption('720p30') })))

    expect(options).toMatchObject({ width: '1280', height: '720', resize_mode: 'scale_aspect' })
  })

  it('captures at the display rate and takes exactly the preset rate from it', () => {
    // Capped at the preset, a 144 Hz display delivers a frame every third
    // refresh: 48 fps, and 25 to 38 in a real game.
    for (const quality of ['720p30', '1080p60'] as const) {
      const chain = videoChain(input({ quality: captureQualityOption(quality) }))
      expect(parseFilter(chain).options.max_framerate).toBe('240')
      expect(chain).toContain(`,fps=${captureQualityOption(quality).fps},`)
    }
  })

  it("records a display preset at the monitor's own rate, every refresh kept", () => {
    const at144 = input({ quality: captureQualityOption('1440pDisplay'), displayHz: 144 })
    const chain = videoChain(at144)

    expect(parseFilter(chain).options).toMatchObject({ width: '2560', height: '1440', max_framerate: '288' })
    expect(chain).toContain(',fps=144,')
    expect(after(buildFfmpegArgs(at144), '-g')).toBe('288')
  })

  it('follows a slower display too', () => {
    const chain = videoChain(input({ quality: captureQualityOption('1080pDisplay'), displayHz: 60 }))
    expect(chain).toContain(',fps=60,')
    expect(parseFilter(chain).options.max_framerate).toBe('240')
  })

  it('drops frames before copying them off the GPU, not after', () => {
    const chain = videoChain(input({ encoder: 'mf' }))
    expect(chain.indexOf('fps=60')).toBeLessThan(chain.indexOf('hwdownload'))
  })

  it('hands NVENC the GPU frames, labelled with the matrix it converts them with', () => {
    const chain = videoChain(input({ encoder: 'nvenc' }))

    expect(chain).not.toContain('hwdownload')
    expect(chain).toContain('setparams=colorspace=bt470bg:range=tv')
  })

  it('converts on the CPU for every other encoder, labelled to match', () => {
    for (const encoder of ['amf', 'qsv', 'mf-hw', 'mf'] as const) {
      const chain = videoChain(input({ encoder }))
      expect(chain).toContain('hwdownload,format=bgra,scale=out_color_matrix=bt709:out_range=tv,format=nv12')
      expect(chain).toContain('setparams=colorspace=bt709:range=tv')
    }
  })

  it("keeps the capture's own frame times, moved onto the wall clock, through both levels of escaping", () => {
    const chain = videoChain(input())
    // The second filter: everything after the first unescaped comma.
    const [, rest] = getToken(chain, ',')
    const { name, options } = parseFilter(rest.slice(1))

    expect(name).toBe('setpts')
    // Stamping each frame with the wall clock as it passed lost half of them:
    // frames come through in clumps, and a clump shared one moment.
    expect(options.expr).toBe(
      'PTS+st(0,if(eq(N,0),RTCTIME/(TB*1000000)-PTS,min(ld(0),RTCTIME/(TB*1000000)-PTS)))'
    )
  })

  it('reads the mixed audio from its pipe and stamps it with the wall clock', () => {
    const args = buildFfmpegArgs(input())

    expect(args.join(' ')).toContain(
      `-f f32le -ar 48000 -ac 2 -use_wallclock_as_timestamps 1 -i ${PIPE}`
    )
    expect(args.join(' ')).toContain('-map [v] -map 0:a')
    expect(after(args, '-af')).toBe('aresample=async=1')
    expect(after(args, '-c:a')).toBe('aac')
  })

  it("keeps the audio out of the capture's filtergraph", () => {
    // Together, capture was asked for a frame only as audio came in: 64 a
    // second from a 144 Hz window, against 134 with the audio apart.
    const graph = after(buildFfmpegArgs(input()), '-filter_complex')!

    expect(graph).toBe(`${videoChain(input())}[v]`)
    expect(graph).not.toContain('0:a')
  })

  it("puts the file's zero at the launch", () => {
    const args = buildFfmpegArgs(input())

    expect(args).toContain('-copyts')
    expect(after(args, '-output_ts_offset')).toBe(String(-LAUNCHED_AT / 1000))
    expect(after(args, '-avoid_negative_ts')).toBe('make_zero')
  })

  it('never ends the video with the audio', () => {
    // q stops both streams; with -shortest, the end of the audio would too.
    expect(buildFfmpegArgs(input())).not.toContain('-shortest')
  })

  it('records video alone when no audio is wanted', () => {
    const args = buildFfmpegArgs(input({ audioInput: null }))

    expect(args).not.toContain('f32le')
    expect(args.join(' ')).not.toContain('\\\\.\\pipe\\')
    expect(args).not.toContain('[a]')
    expect(args).not.toContain('-c:a')
    expect(args).not.toContain('-af')
    expect(args).not.toContain('0:a')
  })

  it('writes fragmented MP4 to the path as one argument, spaces and all', () => {
    const args = buildFfmpegArgs(input())

    expect(after(args, '-movflags')).toBe('+frag_keyframe+empty_moov+default_base_moof')
    expect(args.at(-1)).toBe('D:\\My Videos\\Foxfire\\pending-1.mp4')
    expect(after(args, '-f')).toBe('f32le')
    expect(args.at(-2)).toBe('mp4')
  })

  it('reports progress on stdout, which is where the first frame is noticed', () => {
    const args = buildFfmpegArgs(input())
    expect(after(args, '-progress')).toBe('pipe:1')
  })

  it('keyframes every two seconds at any frame rate', () => {
    expect(after(buildFfmpegArgs(input()), '-g')).toBe('120')
    expect(after(buildFfmpegArgs(input({ quality: captureQualityOption('1080p30') })), '-g')).toBe('60')
  })

  it.each([
    ['nvenc', ['-delay', '0', '-bf', '0']],
    ['amf', ['-async_depth', '1', '-latency', '1', '-bf', '0']],
    ['qsv', ['-async_depth', '1', '-bf', '0']]
  ] as const)('has %s hand each frame back as soon as it is encoded', (encoder, flags) => {
    // A queue of frames in the encoder held the video back far enough for
    // FFmpeg to pause the audio, which came out a tenth of a second short
    // every third of a second.
    const args = buildFfmpegArgs(input({ encoder })).join(' ')
    expect(args).toContain(flags.join(' '))
  })

  it.each([
    ['nvenc', 'h264_nvenc'],
    ['amf', 'h264_amf'],
    ['qsv', 'h264_qsv'],
    ['mf-hw', 'h264_mf'],
    ['mf', 'h264_mf']
  ] as const)('encodes with %s through %s', (encoder, codec) => {
    const args = buildFfmpegArgs(input({ encoder }))
    expect(after(args, '-c:v')).toBe(codec)
    expect(args.includes('-hw_encoding')).toBe(encoder === 'mf-hw')
  })
})

describe('sizing the video', () => {
  it('spends about what the settings screen says a preset costs', () => {
    // 5 GB an hour at 1080p60, less the audio's share.
    expect(videoBitrate(captureQualityOption('1080p60'), 60)).toBe(10_951_111)
    const total = (videoBitrate(captureQualityOption('720p30'), 30) + 160_000) * 3600 / 8 / 1e9
    expect(total).toBeCloseTo(1.5, 5)
  })

  it("quotes a display preset at 144 Hz and scales it to the monitor's rate", () => {
    const preset = captureQualityOption('1080pDisplay')
    const gbPerHour = (fps: number): number => ((videoBitrate(preset, fps) + 160_000) * 3600) / 8 / 1e9

    expect(gbPerHour(144)).toBeCloseTo(9, 5)
    // At 60 Hz, about what the 1080p 60fps preset costs.
    expect(gbPerHour(60)).toBeGreaterThan(4.5)
    expect(gbPerHour(60)).toBeLessThan(5.5)
    expect(gbPerHour(240)).toBeGreaterThan(gbPerHour(144))
  })
})

describe('escaping', () => {
  it('matches a name exactly, its regex characters taken literally', () => {
    expect(exactName('a.b+c(1).exe')).toBe('(?i)^a\\.b\\+c\\(1\\)\\.exe$')
  })

  it('quotes an option value, quotes inside it included', () => {
    expect(quoteOption("it's")).toBe("'it'\\''s'")
  })

  it("escapes the graph's own separators", () => {
    expect(escapeForGraph("a,b;c[d]e'f\\g")).toBe("a\\,b\\;c\\[d\\]e\\'f\\\\g")
  })
})
