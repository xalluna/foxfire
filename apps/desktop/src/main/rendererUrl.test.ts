import { describe, expect, it } from 'vitest'
import { windowRoutes } from '@shared/windowRoutes'
import { rendererUrl } from './rendererUrl'

describe('rendererUrl', () => {
  it('puts the route in the hash of the dev server', () => {
    expect(rendererUrl('/telemetry', 'http://localhost:5173')).toBe('http://localhost:5173#/telemetry')
  })

  it('puts the route in the hash of the packaged index.html', () => {
    const url = rendererUrl('/telemetry', undefined)
    expect(url.startsWith('file:///')).toBe(true)
    expect(url.endsWith('/renderer/index.html#/telemetry')).toBe(true)
  })

  it("keeps a route's search intact, which loadFile's hash option would not", () => {
    const route = windowRoutes.lpEditor('7', 'RANKED_FLEX_SR', 'NA1_5312345678')
    expect(rendererUrl(route, undefined)).toMatch(
      /index\.html#\/lp-editor\?account=7&queue=flex&match=NA1_5312345678$/
    )
  })
})

describe('windowRoutes', () => {
  it('names each window by the route the renderer draws it at', () => {
    expect(windowRoutes.telemetry()).toBe('/telemetry')
    expect(windowRoutes.archives()).toBe('/archives')
    expect(windowRoutes.recording(12)).toBe('/recording/12')
  })

  it('escapes what an account or match id could carry', () => {
    expect(windowRoutes.lpEditor('a&b', 'RANKED_SOLO_5x5', 'KR_1=2')).toBe(
      '/lp-editor?account=a%26b&queue=solo&match=KR_1%3D2'
    )
  })
})
