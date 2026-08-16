// Renders the application icon to resources/icon.ico (plus a PNG master).
//
// electron-builder picks these up automatically: `buildResources: resources` in
// electron-builder.yml makes resources/ the icon search root, and the Windows
// packager asks for `icon.ico` there. Handed a lone PNG it will convert, but its
// converter emits a single 256x256 image and leaves Windows to downscale that
// for the 16 and 32px taskbar and Start menu — the sizes actually looked at all
// day. Rendering each size from the vector instead keeps the mark crisp.
//
// sharp cannot write ICO, so the container is assembled here. Payloads are PNG,
// which every Windows since Vista reads at every size.
//
// The mark is the same rising trend zigzag as the tray icon in src/main/tray.ts,
// on the window's own background colour, so the taskbar button and the tray item
// read as one app. Colours are the --gold / --gold-dim / --canvas tokens from
// src/renderer/src/styles/index.css.
//
// Run with: node scripts/make-icon.mjs
// Re-run when the mark or the palette changes.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICO_OUT = join(ROOT, 'resources', 'icon.ico')
const PNG_OUT = join(ROOT, 'resources', 'icon.png')

/** The shell asks for 16 and 32 constantly; 256 is what Explorer's large view uses. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Drawn once at this size, then rendered down per entry. */
const SIZE = 512

const CANVAS = '#010A13'
const GOLD = '#C8AA6E'
const GOLD_DIM = '#785A28'

// Drawn at 512 and scaled down rather than hand-tuned per size: the stroke is
// heavy enough (44/512) that the 16x16 shell icon still resolves as a zigzag
// instead of a smudge.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${CANVAS}"/>
  <rect x="8" y="8" width="496" height="496" rx="88" fill="none" stroke="${GOLD_DIM}" stroke-width="16"/>
  <path d="M96 352 L200 240 L288 320 L416 160"
        fill="none" stroke="${GOLD}" stroke-width="44"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

function render(size) {
  return sharp(Buffer.from(MARK)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
}

/**
 * Packs PNGs into an ICO: a 6-byte header, then one 16-byte directory entry per
 * image, then the payloads. A dimension of 256 is stored as 0, the format's way
 * of fitting it in a single byte.
 */
function buildIco(images) {
  const HEADER = 6
  const ENTRY = 16

  const header = Buffer.alloc(HEADER)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  let offset = HEADER + ENTRY * images.length

  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(ENTRY)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette size — 0 for truecolour
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

async function main() {
  await mkdir(dirname(ICO_OUT), { recursive: true })

  const images = await Promise.all(
    ICO_SIZES.map(async (size) => ({ size, png: await render(size) }))
  )

  const ico = buildIco(images)
  await writeFile(ICO_OUT, ico)
  console.log(
    `  ok  ${ICO_OUT.slice(ROOT.length + 1)}  ${ICO_SIZES.join('/')}  ${(ico.length / 1024).toFixed(1)}KB`
  )

  // Kept alongside the .ico as the readable master — useful for the README and
  // for any future non-Windows target, which would want a PNG or .icns instead.
  const png = await render(SIZE)
  await writeFile(PNG_OUT, png)
  console.log(`  ok  ${PNG_OUT.slice(ROOT.length + 1)}  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(1)}KB`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
