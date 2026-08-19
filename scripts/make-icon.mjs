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
// The mark is the three-wisp Foxfire logo, drawn from the same geometry the app
// renders in src/renderer/src/components/Logo.tsx — both read src/shared/
// logoMark.json, so the taskbar button, the tray item and the title bar cannot
// drift apart. The tray icon used to be a base64 PNG pasted into tray.ts by
// hand; it is generated here now, for exactly that reason.
//
// Colours are the --accent / --accent-dim / --canvas tokens from
// src/renderer/src/styles/index.css.
//
// Run with: node scripts/make-icon.mjs
// Re-run when the mark or the palette changes.

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICO_OUT = join(ROOT, 'resources', 'icon.ico')
const PNG_OUT = join(ROOT, 'resources', 'icon.png')
const TRAY_OUT = join(ROOT, 'src', 'main', 'trayIcon.ts')
const FAVICON_OUT = join(ROOT, 'src', 'renderer', 'src', 'assets', 'favicon.svg')

/** The one definition of the mark, shared with the renderer. */
const mark = JSON.parse(readFileSync(join(ROOT, 'src', 'shared', 'logoMark.json'), 'utf8'))

/** The shell asks for 16 and 32 constantly; 256 is what Explorer's large view uses. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Drawn once at this size, then rendered down per entry. */
const SIZE = 512

const CANVAS = '#010A13'
const ACCENT = '#9DC8FF'
const ACCENT_DIM = '#3E5F8A'

/** The mark's radius in grid units, as a fraction of the 512 tile. */
const TILE_RADIUS = 170

/** The three wisps, in whatever colour the surface calls for. */
function wisps(colour) {
  return mark.placements
    .map((placement) => `<path d="${mark.wisp}" transform="${placement}" fill="${colour}"/>`)
    .join('\n    ')
}

// Drawn at 512 and scaled down rather than hand-tuned per size. The wisps are
// filled rather than stroked, which is what lets the 16x16 shell icon stay
// legible: solid shapes survive downscaling where a thin outline closes up.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${CANVAS}"/>
  <rect x="8" y="8" width="496" height="496" rx="88" fill="none" stroke="${ACCENT_DIM}" stroke-width="16"/>
  <g transform="translate(256 256) scale(${TILE_RADIUS / mark.extent}) translate(-${mark.grid / 2} -${mark.grid / 2})">
    ${wisps(ACCENT)}
  </g>
</svg>`

/**
 * The tray wants the mark alone on transparency, not the tile: the shell draws
 * it against whatever the taskbar happens to be. Cropped close to the mark's
 * own bounds so it fills its 16 pixels rather than sitting in the tile's
 * margin — but not to the bounds exactly, or the wisps sit a pixel off the edge
 * and read as clipped.
 */
const TRAY_PAD = 1.12

/** Binary fractions of the pad land a trail of 9s in the viewBox otherwise. */
const round = (n) => Number(n.toFixed(3))

const TRAY_HALF = mark.extent * TRAY_PAD
const CROP = `${round(mark.grid / 2 - TRAY_HALF)} ${round(mark.grid / 2 - TRAY_HALF)} ${round(TRAY_HALF * 2)} ${round(TRAY_HALF * 2)}`
const TRAY_MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${CROP}">
  ${wisps(ACCENT)}
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

  // Written as a module rather than a PNG because the main-process bundle has
  // no asset pipeline to load one from disk. Generating it is the point: the
  // previous base64 was maintained by hand and had to be kept in step with this
  // script, which is precisely the kind of promise that gets forgotten.
  const tray = await sharp(Buffer.from(TRAY_MARK)).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(
    TRAY_OUT,
    `// Generated by scripts/make-icon.mjs — do not edit by hand.\n` +
      `// Re-run \`npm run make-icon\` after changing the mark or the accent colour.\n` +
      `export const TRAY_ICON_PNG =\n  '${tray.toString('base64')}'\n`
  )
  console.log(`  ok  ${TRAY_OUT.slice(ROOT.length + 1)}  16x16  ${tray.length}B`)

  // For `npm run dev:web`, which is a browser tab and therefore wants a
  // favicon. Written under the renderer source tree rather than resources/ so
  // Vite emits it into the bundle and it loads from the 'self' origin the CSP
  // already allows — the same reason fetch-assets.mjs puts Riot's crests there.
  await writeFile(
    FAVICON_OUT,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CROP}">\n    ${wisps(ACCENT)}\n</svg>\n`
  )
  console.log(`  ok  ${FAVICON_OUT.slice(ROOT.length + 1)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
