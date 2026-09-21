import { describe, expect, it } from 'vitest'
import { itemSlots } from './items'

describe('itemSlots', () => {
  it('leaves a full build untouched', () => {
    const items = [6672, 3006, 3031, 1038, 6673, 3089, 3363]
    expect(itemSlots(items, 1206)).toEqual([6672, 3006, 3031, 1038, 6673, 3089, 3363, 1206])
  })

  it('packs an interior hole left so the build reads as one run', () => {
    // A real payload: the player sold out of slot 3, leaving a gap mid-build.
    expect(itemSlots([3161, 6631, 3009, 0, 1037, 0, 3364], 1209)).toEqual([
      3161, 6631, 3009, 1037, 0, 0, 3364, 1209
    ])
  })

  it('keeps the trinket and role reward pinned to slots 6 and 7', () => {
    const [, , , , , , trinket, role] = itemSlots([1056, 0, 0, 0, 0, 0, 3340], 3009)
    expect(trinket).toBe(3340)
    expect(role).toBe(3009)
  })

  it('never packs the trinket into an inventory slot it could pass for', () => {
    // Four items and a trinket: the empties must sit between them, not vanish
    // and let the trinket slide left into a square slot.
    expect(itemSlots([3068, 3047, 3075, 3143, 0, 0, 3364], 1208)).toEqual([
      3068, 3047, 3075, 3143, 0, 0, 3364, 1208
    ])
  })

  it('returns eight slots for an empty inventory, so the row still aligns', () => {
    expect(itemSlots([0, 0, 0, 0, 0, 0, 0], 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('pads a short array rather than returning a short row', () => {
    // Nothing produces this today, but a row that renders six icons instead of
    // eight would break the column alignment every other row depends on.
    expect(itemSlots([1056, 3157], 1206)).toEqual([1056, 3157, 0, 0, 0, 0, 0, 1206])
  })
})
