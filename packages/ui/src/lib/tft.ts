import type { AssetManifest, TftAsset, TftAssets, TftUnit } from '@foxfire/core'
import { stageOfRound, tftDisplayName, unitCost } from '@foxfire/core'

/** Which of the manifest's TFT lookups an id is looked up in. */
export type TftAssetKind = keyof TftAssets

/** A unit, trait, item or augment from the manifest, or null when the manifest has none — an older set, say. */
export function tftAsset(manifest: AssetManifest | null, kind: TftAssetKind, id: string): TftAsset | null {
  return manifest?.tft?.[kind][id.toLowerCase()] ?? null
}

/** Its name: the manifest's, or one read out of Riot's id. Never the bare id. */
export function tftName(manifest: AssetManifest | null, kind: TftAssetKind, id: string): string {
  return tftAsset(manifest, kind, id)?.name ?? tftDisplayName(id)
}

/** A unit's cost: Data Dragon's, or worked out from Riot's rarity when it has none. */
export function tftUnitCost(manifest: AssetManifest | null, unit: TftUnit): number {
  return tftAsset(manifest, 'units', unit.characterId)?.cost ?? unitCost(unit.rarity)
}

/**
 * A unit's frame by cost — TFT's own colours, which every player reads the
 * board by. Literal hexes, as the tier colours are: they are the game's
 * meaning, not this app's palette.
 */
const COST_COLORS: Record<number, string> = {
  1: '#8D97A3',
  2: '#2FB577',
  3: '#3D8BFD',
  4: '#B05CF0',
  5: '#E8B53D'
}

export function costColor(cost: number): string {
  return COST_COLORS[Math.min(Math.max(cost, 1), 5)]!
}

/** A trait's chip by how far it is switched on: bronze, silver, gold, prismatic. */
const STYLE_COLORS: Record<number, { fill: string; text: string }> = {
  1: { fill: '#8A5A35', text: '#F3DDC8' },
  2: { fill: '#7E8D96', text: '#F2F6F8' },
  3: { fill: '#C9A13E', text: '#2A1F05' },
  4: { fill: '#9FE6E4', text: '#0F2B33' }
}

export function traitStyle(style: number): { fill: string; text: string } | null {
  return STYLE_COLORS[Math.min(style, 4)] ?? null
}

/**
 * A placement's colour, by what it was worth: a win gold, the rest of the top
 * half teal, the bottom half dim. In Double Up the team's place is what counts.
 */
export function placementTone(placement: number, top: number): 'first' | 'top' | 'bottom' {
  if (placement === 1) return 'first'
  return placement <= top ? 'top' : 'bottom'
}

/** "Stage 6-5", or "Round 20" where the stage cannot be worked out. */
export function formatStage(lastRound: number, queueId: number | null): string {
  const stage = stageOfRound(lastRound, queueId)
  return stage ? `Stage ${stage.stage}-${stage.round}` : `Round ${lastRound}`
}

/** Up to two letters for a unit with no portrait, read from its name. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase()
}
