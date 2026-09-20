// Downloads the rank crests and position icons the UI needs from Community
// Dragon into src/renderer/src/assets/.
//
// These live in the renderer source tree (not resources/) so Vite emits them
// into the renderer bundle. They then load from the 'self' origin, which the
// CSP in src/renderer/index.html already allows — no policy change needed.
// Files under resources/ would resolve over file:// and break in dev.
//
// Run with: node scripts/fetch-assets.mjs
// Re-run when Riot changes tier art (a new tier, a visual refresh).

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'src', 'renderer', 'src', 'assets')

const CDRAGON = 'https://raw.communitydragon.org/latest/plugins'

/** Crests are rendered at 20-56px; 128 keeps them crisp on a 2x display. */
const CREST_SIZE = 128

// Sourced from "ranked-emblem" rather than the smaller "ranked-mini-crests"
// set: the mini crests predate Emerald and have never included it, in `latest`
// or in any versioned snapshot. The emblems are the only complete set. They
// ship as letterboxed hero art up to 2560x1440 (~1MB for all ten), so we trim
// the transparent margin and downscale — otherwise a single decoded crest
// costs ~14MB of memory, which matters in the ten-row live-game list.
const TIERS = [
  'iron',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'emerald',
  'diamond',
  'master',
  'grandmaster',
  'challenger'
]

// Riot's own champ-select icons. They ship already filled with Riot's #785a28
// and #c8aa6e, and are left that way — the app's own accent moved off gold in
// 0.8.0, but Riot's art keeps Riot's palette. See src/renderer/src/lib/positions.ts.
const POSITIONS = ['top', 'jungle', 'middle', 'bottom', 'utility']

/** Smallest plausible download per type — guards against a 404 page or empty body being written as an asset. */
const MIN_BYTES = { png: 2000, svg: 100 }

async function fetchAsset(url, minBytes) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < minBytes) {
    throw new Error(`Suspiciously small (${buf.length}B, expected >=${minBytes}B) — ${url}`)
  }
  return buf
}

/**
 * Strips the `<?xml-stylesheet href="./glow.css"?>` instruction Riot ships on
 * the position icons. The stylesheet isn't part of the download, so leaving the
 * reference in produces a failed request on every render.
 */
function cleanSvg(buf) {
  return Buffer.from(buf.toString('utf8').replace(/<\?xml-stylesheet[^?]*\?>\s*/g, '').trim() + '\n')
}

/** Trims the transparent letterbox margin, then fits the crest into a square canvas. */
function toCrest(buf) {
  return sharp(buf)
    .trim()
    .resize(CREST_SIZE, CREST_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function main() {
  await mkdir(join(ASSETS, 'ranks'), { recursive: true })
  await mkdir(join(ASSETS, 'positions'), { recursive: true })

  const jobs = [
    ...TIERS.map((tier) => ({
      url: `${CDRAGON}/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier}.png`,
      out: join(ASSETS, 'ranks', `${tier}.png`),
      min: MIN_BYTES.png,
      transform: toCrest
    })),
    ...POSITIONS.map((position) => ({
      url: `${CDRAGON}/rcp-fe-lol-champ-select/global/default/svg/position-${position}.svg`,
      out: join(ASSETS, 'positions', `${position}.svg`),
      min: MIN_BYTES.svg,
      transform: cleanSvg
    }))
  ]

  const failures = []

  for (const job of jobs) {
    try {
      const buf = await job.transform(await fetchAsset(job.url, job.min))
      await writeFile(job.out, buf)
      console.log(`  ok  ${job.out.slice(ROOT.length + 1)}  ${(buf.length / 1024).toFixed(1)}KB`)
    } catch (err) {
      failures.push(`${job.url}\n      ${err.message}`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} asset(s) failed:\n  - ${failures.join('\n  - ')}`)
    console.error(
      '\nCommunity Dragon reorganises plugin paths between releases. Browse\n' +
        'https://raw.communitydragon.org/latest/plugins/ to find the new location.'
    )
    process.exit(1)
  }

  console.log(`\n${jobs.length} assets written to src/renderer/src/assets/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
