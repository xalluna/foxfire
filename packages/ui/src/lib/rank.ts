import type { LeagueEntry, QueueType } from '@foxfire/core'

import iron from '../assets/ranks/iron.png'
import bronze from '../assets/ranks/bronze.png'
import silver from '../assets/ranks/silver.png'
import gold from '../assets/ranks/gold.png'
import platinum from '../assets/ranks/platinum.png'
import emerald from '../assets/ranks/emerald.png'
import diamond from '../assets/ranks/diamond.png'
import master from '../assets/ranks/master.png'
import grandmaster from '../assets/ranks/grandmaster.png'
import challenger from '../assets/ranks/challenger.png'

/**
 * Tier identity — crest art plus the colour League itself uses for each tier.
 *
 * These hexes are deliberately literal rather than theme tokens: they are
 * League's semantics, not this app's, and must stay recognisable even if the
 * palette in styles/index.css is later swapped.
 *
 * Crests are fetched and downscaled by scripts/fetch-assets.mjs. Vite emits
 * them into the renderer bundle, so they load from the 'self' origin the CSP
 * already allows.
 */
const TIERS = {
  IRON: { crest: iron, color: '#6B5F5B', label: 'Iron' },
  BRONZE: { crest: bronze, color: '#A66A3F', label: 'Bronze' },
  SILVER: { crest: silver, color: '#9AAEB5', label: 'Silver' },
  GOLD: { crest: gold, color: '#E1B961', label: 'Gold' },
  PLATINUM: { crest: platinum, color: '#4EA5A2', label: 'Platinum' },
  EMERALD: { crest: emerald, color: '#2FB577', label: 'Emerald' },
  DIAMOND: { crest: diamond, color: '#7B8FE8', label: 'Diamond' },
  MASTER: { crest: master, color: '#B558E8', label: 'Master' },
  GRANDMASTER: { crest: grandmaster, color: '#E05656', label: 'Grandmaster' },
  CHALLENGER: { crest: challenger, color: '#4FD3F0', label: 'Challenger' }
} as const

export type Tier = keyof typeof TIERS

export function isTier(value: string | null): value is Tier {
  return value !== null && value in TIERS
}

export function tierCrest(tier: string | null): string | null {
  return isTier(tier) ? TIERS[tier].crest : null
}

/** Falls back to the dim text token so unranked never reads as a real tier. */
export function tierColor(tier: string | null): string {
  return isTier(tier) ? TIERS[tier].color : 'rgb(var(--text-mute))'
}

/**
 * "Gold II" — Roman division suffix omitted for the apex tiers, which are
 * single-division and always report rank "I".
 */
export function tierLabel(tier: string | null, division: string | null): string {
  if (!isTier(tier)) return 'Unranked'
  const { label } = TIERS[tier]
  const isApex = tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER'
  return isApex || !division ? label : `${label} ${division}`
}

const ROMAN_TO_ARABIC: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' }

const APEX_SHORT: Record<string, string> = { MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' }

/**
 * "G1" — the compact form for the match-row LP chip, where the full "Gold II"
 * would crowd an already dense row. Apex tiers have no division to append.
 */
export function formatTierShort(tier: string | null, division: string | null): string | null {
  if (!isTier(tier)) return null
  const apex = APEX_SHORT[tier]
  if (apex) return apex
  const arabic = ROMAN_TO_ARABIC[division ?? '']
  return arabic ? `${TIERS[tier].label[0]}${arabic}` : TIERS[tier].label[0]
}

export function queueLabel(queueType: QueueType): string {
  return queueType === 'RANKED_SOLO_5x5' ? 'Ranked Solo/Duo' : 'Ranked Flex'
}

export interface RankRecord {
  games: number
  winRate: number | null
}

export function rankRecord(entry: Pick<LeagueEntry, 'wins' | 'losses'>): RankRecord {
  const games = (entry.wins ?? 0) + (entry.losses ?? 0)
  return {
    games,
    winRate: games > 0 ? Math.round(((entry.wins ?? 0) / games) * 100) : null
  }
}

/** An all-null entry, so an unplayed queue still renders a card instead of a hole. */
export function emptyEntry(queueType: QueueType): LeagueEntry {
  return {
    queueType,
    tier: null,
    rank: null,
    leaguePoints: null,
    wins: null,
    losses: null,
    fetchedAt: ''
  }
}
