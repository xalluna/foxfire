import type { AssetManifest } from '../types'

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

/**
 * The current patch's champions, summoner spells and runes, keyed the way
 * match data refers to them.
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
