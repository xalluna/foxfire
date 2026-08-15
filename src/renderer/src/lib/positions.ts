import top from '../assets/positions/top.svg'
import jungle from '../assets/positions/jungle.svg'
import middle from '../assets/positions/middle.svg'
import bottom from '../assets/positions/bottom.svg'
import utility from '../assets/positions/utility.svg'

/**
 * Riot's own champ-select position icons, keyed by the `teamPosition` values
 * match-v5 returns. They ship pre-filled with #785a28 and #c8aa6e — the same
 * two golds as the --gold-dim and --gold tokens — so they need no recolouring.
 *
 * teamPosition is an empty string for modes without lanes (ARAM, Arena), which
 * is why every lookup here can return null.
 */
const POSITIONS = {
  TOP: { icon: top, label: 'Top' },
  JUNGLE: { icon: jungle, label: 'Jungle' },
  MIDDLE: { icon: middle, label: 'Mid' },
  BOTTOM: { icon: bottom, label: 'Bot' },
  UTILITY: { icon: utility, label: 'Support' }
} as const

export type Position = keyof typeof POSITIONS

export const POSITION_ORDER: Position[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

export function isPosition(value: string | null): value is Position {
  return value !== null && value in POSITIONS
}

export function positionIcon(position: string | null): string | null {
  return isPosition(position) ? POSITIONS[position].icon : null
}

export function positionLabel(position: string | null): string | null {
  return isPosition(position) ? POSITIONS[position].label : null
}
