import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { createLogger } from '../../telemetry/logger'
import type { NativeCaptureCheck, NativeEncoder } from '@shared/types'
import { ENCODER_ORDER, chooseEncoder, hasWindowCapture, parseFfmpegVersion, probeArgs } from './encoders'
import { displayRefreshRate } from './displayRate'

/**
 * The FFmpeg the native recorder runs, and what it can do on this PC.
 *
 * Shipped beside the app rather than found on the PATH: whatever FFmpeg
 * somebody has installed may be years older than window capture, or built
 * without the encoders. electron-builder copies resources/ffmpeg into the
 * install's resources folder; a dev build reads it where scripts/fetch-ffmpeg.mjs
 * put it.
 */
const log = createLogger('capture')

export function ffmpegPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : join(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe')
}

/** Runs FFmpeg to completion, for the short questions asked of it. Never throws. */
function run(exe: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: err === null, output: `${stdout}${stderr}` })
    })
  })
}

let cached: NativeCaptureCheck | null = null
let pending: Promise<NativeCaptureCheck> | null = null

/**
 * What the native recorder has to work with: the FFmpeg, and every encoder
 * that really encodes here.
 *
 * Asked once per process and remembered — a probe opens every encoder in turn,
 * which takes a second or two — unless `fresh`, which the settings screen's
 * check asks for after a driver update or a new GPU.
 */
export function checkNativeCapture(fresh = false): Promise<NativeCaptureCheck> {
  if (!fresh && cached) return Promise.resolve(cached)
  if (pending) return pending

  pending = probe()
    .then((check) => {
      cached = check
      log.info('Native capture checked', {
        ffmpeg: check.ffmpeg,
        version: check.version,
        encoder: check.encoder,
        encoders: check.encoders
      })
      return check
    })
    .finally(() => {
      pending = null
    })
  return pending
}

/** The last answer, without asking again. */
export function lastNativeCapture(): NativeCaptureCheck | null {
  return cached
}

async function probe(): Promise<NativeCaptureCheck> {
  const exe = ffmpegPath()
  const displayHz = displayRefreshRate()
  if (!existsSync(exe)) return { ffmpeg: 'missing', version: null, encoder: null, encoders: [], displayHz }

  const about = await run(exe, ['-hide_banner', '-version'], 10_000)
  const version = parseFfmpegVersion(about.output)
  if (!about.ok) return { ffmpeg: 'missing', version, encoder: null, encoders: [], displayHz }
  if (!hasWindowCapture(version)) return { ffmpeg: 'tooOld', version, encoder: null, encoders: [], displayHz }

  // One at a time: two hardware encoders opened at once on one GPU can each
  // fail for want of the session the other holds.
  const encoders: NativeEncoder[] = []
  for (const encoder of ENCODER_ORDER) {
    const result = await run(exe, probeArgs(encoder), 15_000)
    if (result.ok) encoders.push(encoder)
  }

  return { ffmpeg: 'ok', version, encoder: chooseEncoder(encoders), encoders, displayHz }
}
