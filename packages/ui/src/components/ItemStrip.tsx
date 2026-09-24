import type { AssetManifest } from '@foxfire/core'
import { TRINKET_SLOT, itemSlots } from '../lib/items'
import { itemIconUrl } from '../lib/assets'
import { Asset } from './Asset'

/**
 * Six inventory slots, then the trinket, then the lane's quest reward.
 *
 * The last two are round because neither was bought. `roleBound` stays a
 * separate prop rather than an eighth array entry so a caller cannot slip it
 * into an inventory position. See itemSlots for why the six are packed and why
 * nothing collapses when a slot is empty.
 *
 * A component rather than a copy in each view: the match row and the match
 * detail panel draw the same eight squares, differing only in how big they are.
 * The size arrives as a literal utility class rather than a number, because
 * Tailwind only emits the classes it can see in the source.
 */
export function ItemStrip({
  m,
  items,
  roleBound,
  size = 'h-[22px] w-[22px]'
}: {
  m: AssetManifest
  items: number[]
  roleBound: number
  /** Sizing utilities for one square, e.g. `h-[21px] w-[21px]`. */
  size?: string
}): JSX.Element {
  return (
    <div className="flex gap-[3px]">
      {itemSlots(items, roleBound).map((itemId, i) => (
        <Asset
          key={i}
          src={itemIconUrl(m, itemId)}
          className={size}
          rounded={i >= TRINKET_SLOT ? 'rounded-full' : 'rounded'}
        />
      ))}
    </div>
  )
}
