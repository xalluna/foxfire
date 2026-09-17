import type { AssetManifest } from '@shared/types'

// Data Dragon is a static CDN, not the rate-limited Riot API — these calls
// deliberately bypass the Riot rate limiter.
const DDRAGON = 'https://ddragon.leagueoflegends.com'
const REALM_URL = `${DDRAGON}/realms/na.json`

let cached: AssetManifest | null = null
let inFlight: Promise<AssetManifest> | null = null

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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Data Dragon ${res.status} for ${url}`)
  return (await res.json()) as T
}

async function build(): Promise<AssetManifest> {
  const realm = await fetchJson<{ v: string; cdn: string }>(REALM_URL)
  const version = realm.v
  const cdn = realm.cdn

  const [champions, spells, runeTrees] = await Promise.all([
    fetchJson<ChampionJson>(`${cdn}/${version}/data/en_US/champion.json`),
    fetchJson<SummonerJson>(`${cdn}/${version}/data/en_US/summoner.json`),
    fetchJson<RuneTreeJson[]>(`${cdn}/${version}/data/en_US/runesReforged.json`)
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

  return { version, cdn, championById, spellById, runeById }
}

/** Cached for the process lifetime — patch changes are rare enough to not warrant invalidation. */
export function getAssetManifest(): Promise<AssetManifest> {
  if (cached) return Promise.resolve(cached)
  if (!inFlight) {
    inFlight = build()
      .then((manifest) => {
        cached = manifest
        return manifest
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}
