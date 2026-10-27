import type { AssetManifest, TftAsset, TftAssets } from '../types'

// Data Dragon is a static CDN, not the rate-limited Riot API — these calls
// deliberately bypass the Riot rate limiter, and need no key. It also answers
// with `Access-Control-Allow-Origin: *`, which is what lets a browser build the
// manifest itself rather than asking a server to relay a public file.
export const DDRAGON = 'https://ddragon.leagueoflegends.com'
const REALM_URL = `${DDRAGON}/realms/na.json`

interface ChampionJson {
  data: Record<string, { id: string; key: string; name: string }>
}

interface SummonerJson {
  data: Record<string, { id: string; key: string; name: string }>
}

interface RuneTreeJson {
  id: number
  key: string
  icon: string
  name: string
  slots: Array<{ runes: Array<{ id: number; key: string; icon: string; name: string }> }>
}

/** One of Data Dragon's TFT files: entries keyed by a path, each carrying the id match data uses. */
interface TftJson {
  data: Record<string, { id?: string; name?: string; tier?: number; image?: { full?: string; group?: string } }>
}

/**
 * Data Dragon's TFT files, as one lookup per kind.
 *
 * Keyed by the entry's own `id` — `TFT18_Jinx`, `TFT_Item_InfinityEdge` —
 * lower-cased, because that is what tft-match-v1 sends and Riot is not
 * consistent about its case between the two. A file keys its entries by a path
 * into the game's data instead, which is no use to anything reading a match.
 *
 * Data Dragon carries the current set; a game from an older one names units it
 * does not have, and a client draws those by name.
 */
export function tftLookup(json: TftJson, cdn: string, version: string): Record<string, TftAsset> {
  const lookup: Record<string, TftAsset> = {}
  for (const entry of Object.values(json.data ?? {})) {
    if (!entry.id || !entry.name) continue
    const image = entry.image?.full && entry.image.group
      ? `${cdn}/${version}/img/${entry.image.group}/${entry.image.full}`
      : null
    lookup[entry.id.toLowerCase()] = { name: entry.name, image, ...(entry.tier ? { cost: entry.tier } : {}) }
  }
  return lookup
}

/**
 * TFT's units, traits, items and augments, or undefined when Data Dragon will
 * not give them.
 *
 * Settled one by one rather than all or nothing: TFT's files are the newest
 * and least looked-after on the CDN, and a missing one must cost TFT its icons
 * — names stand in for them — never League its manifest.
 */
async function buildTftAssets(
  fetchJson: <T>(url: string) => Promise<T>,
  cdn: string,
  version: string
): Promise<TftAssets | undefined> {
  const files = ['tft-champion', 'tft-trait', 'tft-item', 'tft-augments'] as const
  const settled = await Promise.allSettled(
    files.map((file) => fetchJson<TftJson>(`${cdn}/${version}/data/en_US/${file}.json`))
  )

  const lookups = settled.map((result) => (result.status === 'fulfilled' ? tftLookup(result.value, cdn, version) : {}))
  if (lookups.every((lookup) => Object.keys(lookup).length === 0)) return undefined

  const [units, traits, items, augments] = lookups as [
    Record<string, TftAsset>,
    Record<string, TftAsset>,
    Record<string, TftAsset>,
    Record<string, TftAsset>
  ]
  return { units, traits, items, augments }
}

/**
 * The current patch's champions, summoner spells and runes, keyed the way
 * match data refers to them — and TFT's units, traits, items and augments.
 *
 * Built fresh on every call. Caching is the caller's, because how long one is
 * worth keeping differs: the desktop keeps it for the life of the process, a
 * browser for the life of its query cache.
 */
export async function buildAssetManifest(fetchImpl: typeof fetch = fetch): Promise<AssetManifest> {
  const fetchJson = async <T>(url: string): Promise<T> => {
    const res = await fetchImpl(url)
    if (!res.ok) throw new Error(`Data Dragon ${res.status} for ${url}`)
    return (await res.json()) as T
  }

  const realm = await fetchJson<{ v: string; cdn: string }>(REALM_URL)
  const version = realm.v
  const cdn = realm.cdn

  const [champions, spells, runeTrees, tft] = await Promise.all([
    fetchJson<ChampionJson>(`${cdn}/${version}/data/en_US/champion.json`),
    fetchJson<SummonerJson>(`${cdn}/${version}/data/en_US/summoner.json`),
    fetchJson<RuneTreeJson[]>(`${cdn}/${version}/data/en_US/runesReforged.json`),
    buildTftAssets(fetchJson, cdn, version)
  ])

  // match-v5 reports numeric champion/spell IDs; Data Dragon keys its images
  // by string id, so build the reverse lookups once here.
  const championById: Record<number, { id: string; name: string }> = {}
  for (const champ of Object.values(champions.data)) {
    championById[Number(champ.key)] = { id: champ.id, name: champ.name }
  }

  const spellById: Record<number, { id: string; name: string }> = {}
  for (const spell of Object.values(spells.data)) {
    spellById[Number(spell.key)] = { id: spell.id, name: spell.name }
  }

  const runeById: Record<number, { icon: string; name: string }> = {}
  for (const tree of runeTrees) {
    runeById[tree.id] = { icon: tree.icon, name: tree.name }
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        runeById[rune.id] = { icon: rune.icon, name: rune.name }
      }
    }
  }

  return { version, cdn, championById, spellById, runeById, ...(tft ? { tft } : {}) }
}
