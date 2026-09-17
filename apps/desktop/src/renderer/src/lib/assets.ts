import type { AssetManifest } from '@shared/types'

// URL builders for Data Dragon images. Images load straight from the CDN —
// the renderer's CSP allows img-src from ddragon but not fetch/XHR, which is
// why the JSON manifests come over IPC instead.

export function championIconUrl(m: AssetManifest, championId: number): string | null {
  const champ = m.championById[championId]
  if (!champ) return null
  return `${m.cdn}/${m.version}/img/champion/${champ.id}.png`
}

export function championName(m: AssetManifest, championId: number, fallback?: string | null): string {
  return m.championById[championId]?.name ?? fallback ?? 'Unknown'
}

export function itemIconUrl(m: AssetManifest, itemId: number): string | null {
  if (!itemId) return null // 0 = empty slot
  return `${m.cdn}/${m.version}/img/item/${itemId}.png`
}

export function spellIconUrl(m: AssetManifest, spellId: number): string | null {
  const spell = m.spellById[spellId]
  if (!spell) return null
  return `${m.cdn}/${m.version}/img/spell/${spell.id}.png`
}

/** Rune icons live under a version-less path, unlike every other Data Dragon asset. */
export function runeIconUrl(m: AssetManifest, runeId: number): string | null {
  const rune = m.runeById[runeId]
  if (!rune) return null
  return `${m.cdn}/img/${rune.icon}`
}

export function profileIconUrl(m: AssetManifest, iconId: number | null): string | null {
  if (iconId === null) return null
  return `${m.cdn}/${m.version}/img/profileicon/${iconId}.png`
}
