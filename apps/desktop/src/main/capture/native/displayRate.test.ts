import { beforeEach, describe, expect, it, vi } from 'vitest'

const displays = vi.hoisted(() => ({ list: [] as Array<{ displayFrequency: number }> }))

vi.mock('electron', () => ({ screen: { getAllDisplays: () => displays.list } }))

const { clampRefreshRate, displayRefreshRate } = await import('./displayRate')

beforeEach(() => {
  displays.list = []
})

describe('the refresh rate a display preset records at', () => {
  it("is the fastest monitor's, so the game's is never undercut", () => {
    displays.list = [{ displayFrequency: 60 }, { displayFrequency: 144 }]
    expect(displayRefreshRate()).toBe(144)
  })

  it('is a whole number of frames', () => {
    expect(clampRefreshRate(143.856)).toBe(144)
    expect(clampRefreshRate(59.94)).toBe(60)
  })

  it('falls back to 60 when Windows says nothing believable', () => {
    expect(displayRefreshRate()).toBe(60)
    expect(clampRefreshRate(0)).toBe(60)
    expect(clampRefreshRate(Number.NaN)).toBe(60)
  })

  it('stops at 360', () => {
    expect(clampRefreshRate(540)).toBe(360)
  })
})
