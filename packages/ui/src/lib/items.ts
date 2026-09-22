/** Where the trinket sits in match-v5's inventory, and in the rendered strip. */
export const TRINKET_SLOT = 6

/**
 * The eight icons of a match row, in render order.
 *
 * match-v5 reports inventory positionally, so a player who sold an item leaves
 * a zero where it was: `[3161, 6631, 3009, 0, 1037, 0, 3364]`. Rendered
 * literally that is a hole punched through the middle of the build, and the
 * trailing one sits between the last item and the trinket. The six purchased
 * slots are packed left so the empties collect together instead.
 *
 * Positions 6 and 7 are fixed rather than packed: the trinket is always item6
 * — over the whole stored history it appears nowhere else — and the quest
 * reward is not part of the inventory at all. Pinning them keeps the two round
 * icons against the last real item on every row.
 *
 * Always returns eight entries, 0 meaning an empty slot. Nothing collapses, so
 * every row is the same width and the strips stay column-aligned down a list
 * mixing Summoner's Rift with ARAM.
 */
export function itemSlots(items: number[], roleBoundItem: number): number[] {
  const purchased = items.slice(0, TRINKET_SLOT).filter((id) => id !== 0)
  return [
    ...purchased,
    ...Array.from({ length: TRINKET_SLOT - purchased.length }, () => 0),
    items[TRINKET_SLOT] ?? 0,
    roleBoundItem
  ]
}
