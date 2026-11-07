import type { NativeEncoder } from '@shared/types'

/**
 * Which H.264 encoder the native recorder uses, and how it finds out.
 *
 * The GPU vendors' own encoders first, because they leave the game's frame rate
 * alone; then Windows' Media Foundation on the GPU, which reaches hardware the
 * first three do not know; then Media Foundation on the CPU, which every
 * Windows install has and which costs the game something. Whatever is first and
 * actually works on this PC is the one — a listed encoder is not a working one:
 * FFmpeg lists NVENC on a PC with no NVIDIA card.
 */
export const ENCODER_ORDER: readonly NativeEncoder[] = ['nvenc', 'amf', 'qsv', 'mf-hw', 'mf']

export function chooseEncoder(working: readonly NativeEncoder[]): NativeEncoder | null {
  return ENCODER_ORDER.find((encoder) => working.includes(encoder)) ?? null
}

/**
 * A handful of black frames through one encoder, discarded. Exits 0 only if
 * the encoder opened and encoded, which is the whole question.
 *
 * 1280x720 rather than something tiny: hardware encoders refuse sizes below
 * their minimum, and Media Foundation's software encoder refuses odd ones.
 */
export function probeArgs(encoder: NativeEncoder): string[] {
  const codec: Record<NativeEncoder, string[]> = {
    nvenc: ['-c:v', 'h264_nvenc'],
    amf: ['-c:v', 'h264_amf'],
    qsv: ['-c:v', 'h264_qsv'],
    'mf-hw': ['-c:v', 'h264_mf', '-hw_encoding', '1'],
    mf: ['-c:v', 'h264_mf']
  }
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=1280x720:r=30',
    '-frames:v',
    '5',
    '-pix_fmt',
    'nv12',
    ...codec[encoder],
    '-f',
    'null',
    '-'
  ]
}

/** FFmpeg's version line, e.g. "ffmpeg version n9.0.2-36-g6882969ce9 Copyright …". */
export function parseFfmpegVersion(output: string): string | null {
  return /ffmpeg version (\S+)/.exec(output)?.[1] ?? null
}

/**
 * Whether this FFmpeg has window capture, which arrived in 8.1.
 *
 * A release names itself "n9.0.2" (or "9.0.2"); a build of the development
 * branch names itself "N-128122-g…" and is newer than any release.
 */
export function hasWindowCapture(version: string | null): boolean {
  if (version === null) return false
  if (/^N-\d+/.test(version)) return true
  const match = /^n?(\d+)\.(\d+)/.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 8 || (major === 8 && minor >= 1)
}
