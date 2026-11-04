// Fetches the FFmpeg the native recorder runs into resources/ffmpeg/, which
// electron-builder ships beside the app (extraResources) and the dev build
// reads in place. Gitignored: it is 150 MB of somebody else's binary.
//
// One build, pinned by URL and SHA-256, so every installer carries exactly the
// FFmpeg that was tested. LGPL rather than GPL: nothing here uses x264 or any
// other GPL encoder — the recorder encodes on the GPU, or through Windows' own
// Media Foundation — and LGPL keeps the obligation to shipping its licence.
//
// After extracting, the binary is asked what it can do, and the fetch fails
// unless it has everything the recorder needs: gfxcapture (window capture,
// FFmpeg 8.1+), the four H.264 encoders it chooses between, and AAC. A build
// without them would install fine and record nothing.
//
// Run with: npm run fetch-ffmpeg -w @foxfire/desktop
// Idempotent: a matching binary already in place is left alone.
//
// Bumping the pin: BtbN publishes a dated autobuild every day and prunes old
// ones, so a pin eventually stops downloading. Take the newest
// autobuild-YYYY-MM-DD-HH-MM release's `ffmpeg-n<major>.<minor>…-win64-lgpl-…zip`
// (not -shared), copy its name and the sha256 digest GitHub lists for it, and
// record a game with the result before shipping it.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const PIN = {
  release: 'autobuild-2026-10-27-18-38',
  name: 'ffmpeg-n9.0.2-36-g6882969ce9-win64-lgpl-9.0',
  sha256: '79e8ff30c01ac58a2bc4e820c86be81d426ea0bee10df8030fc6ac3c72fe785c'
}

const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${PIN.release}/${PIN.name}.zip`

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'ffmpeg')
/** Written last, so a half-finished fetch is never mistaken for a finished one. */
const STAMP = join(OUT, 'pin.txt')

/** What the recorder needs, by the name FFmpeg lists it under. */
const REQUIRED_FILTERS = ['gfxcapture', 'scale_d3d11', 'hwdownload', 'aresample']
const REQUIRED_ENCODERS = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'aac']

async function alreadyInPlace() {
  if (!existsSync(join(OUT, 'ffmpeg.exe')) || !existsSync(STAMP)) return false
  const [sha] = (await readFile(STAMP, 'utf8')).split('\n')
  return sha?.trim() === PIN.sha256
}

async function download(to) {
  console.log(`Downloading ${PIN.name}.zip`)
  const res = await fetch(URL)
  if (!res.ok || !res.body) {
    throw new Error(
      `HTTP ${res.status} — ${URL}\n` +
        'If this is a 404, BtbN has pruned the pinned build: bump PIN (see the top of this file).'
    )
  }

  const hash = createHash('sha256')
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => hash.update(chunk))
  await pipeline(body, createWriteStream(to))

  const digest = hash.digest('hex')
  if (digest !== PIN.sha256) {
    throw new Error(`Checksum mismatch for ${PIN.name}.zip: expected ${PIN.sha256}, got ${digest}`)
  }
}

/**
 * Takes the two files wanted out of the zip and nothing else.
 *
 * Windows' own tar (bsdtar) reads zips; the GNU tar Git for Windows puts first
 * on a runner's PATH does not, hence the absolute path.
 */
function extract(zip, into) {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-xf', zip, '-C', into, `${PIN.name}/bin/ffmpeg.exe`, `${PIN.name}/LICENSE.txt`], {
    stdio: 'inherit'
  })
}

function verify(exe) {
  const run = (args) => execFileSync(exe, ['-hide_banner', ...args], { encoding: 'utf8' })
  const filters = run(['-filters'])
  const encoders = run(['-encoders'])

  const has = (listing, name) => new RegExp(`\\s${name}\\s`).test(listing)
  const missing = [
    ...REQUIRED_FILTERS.filter((name) => !has(filters, name)).map((name) => `filter ${name}`),
    ...REQUIRED_ENCODERS.filter((name) => !has(encoders, name)).map((name) => `encoder ${name}`)
  ]
  if (missing.length > 0) {
    throw new Error(`${PIN.name} is missing what the recorder needs: ${missing.join(', ')}`)
  }
}

async function main() {
  if (await alreadyInPlace()) {
    console.log(`FFmpeg ${PIN.name} already in resources/ffmpeg`)
    return
  }

  // Downloaded and unpacked in a directory of its own, outside the checkout.
  const work = await mkdtemp(join(tmpdir(), 'foxfire-ffmpeg-'))
  try {
    const zip = join(work, `${PIN.name}.zip`)
    await download(zip)
    extract(zip, work)

    const unpacked = join(work, PIN.name)
    verify(join(unpacked, 'bin', 'ffmpeg.exe'))

    await rm(OUT, { recursive: true, force: true })
    await mkdir(OUT, { recursive: true })
    await rename(join(unpacked, 'bin', 'ffmpeg.exe'), join(OUT, 'ffmpeg.exe'))
    await rename(join(unpacked, 'LICENSE.txt'), join(OUT, 'LICENSE.txt'))
    await writeFile(STAMP, `${PIN.sha256}\n${PIN.name}\n`)
    console.log(`FFmpeg ${PIN.name} → resources/ffmpeg`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
