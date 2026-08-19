import { isPosition, type Position } from '@shared/positions'
import top from '../assets/positions/top.svg'
import jungle from '../assets/positions/jungle.svg'
import middle from '../assets/positions/middle.svg'
import bottom from '../assets/positions/bottom.svg'
import utility from '../assets/positions/utility.svg'

/**
 * Riot's own champ-select position icons, keyed by the `teamPosition` values
 * match-v5 returns. They ship pre-filled with Riot's #785a28 and #c8aa6e and
 * are left that way — as the rank crests are — rather than being pulled onto
 * the app's own accent. Riot's art keeps Riot's palette.
 *
 * teamPosition is an empty string for modes without lanes (ARAM, Arena), which
 * is why every lookup here can return null.
 */
const POSITIONS: Record<Position, { icon: string; label: string }> = {
  TOP: { icon: top, label: 'Top' },
  JUNGLE: { icon: jungle, label: 'Jungle' },
  MIDDLE: { icon: middle, label: 'Mid' },
  BOTTOM: { icon: bottom, label: 'Bot' },
  UTILITY: { icon: utility, label: 'Support' }
}

export { isPosition, POSITION_ORDER, type Position } from '@shared/positions'

export function positionIcon(position: string | null): string | null {
  return isPosition(position) ? POSITIONS[position].icon : null
}

export function positionLabel(position: string | null): string | null {
  return isPosition(position) ? POSITIONS[position].label : null
}
