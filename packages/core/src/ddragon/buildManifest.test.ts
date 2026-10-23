import { describe, expect, it } from 'vitest'
import { buildAssetManifest } from './buildManifest'

const CDN = 'https://ddragon.example/cdn'

const FILES: Record<string, unknown> = {
  'https://ddragon.leagueoflegends.com/realms/na.json': { v: '16.16.1', cdn: CDN },
  [`${CDN}/16.16.1/data/en_US/champion.json`]: {
    data: { Ahri: { id: 'Ahri', key: '103', name: 'Ahri' }, MonkeyKing: { id: 'MonkeyKing', key: '62', name: 'Wukong' } }
  },
  [`${CDN}/16.16.1/data/en_US/summoner.json`]: {
    data: { SummonerFlash: { id: 'SummonerFlash', key: '4', name: 'Flash' } }
  },
  [`${CDN}/16.16.1/data/en_US/runesReforged.json`]: [
    {
      id: 8100,
      key: 'Domination',
      icon: 'perk-images/Styles/7200_Domination.png',
      name: 'Domination',
      slots: [{ runes: [{ id: 8112, key: 'Electrocute', icon: 'perk-images/Electrocute.png', name: 'Electrocute' }] }]
    }
  ]
}

const fakeFetch = (async (input: string | URL | Request) => {
  const body = FILES[String(input)]
  return body === undefined
    ? new Response('missing', { status: 404 })
    : new Response(JSON.stringify(body), { status: 200 })
}) as typeof fetch

describe('buildAssetManifest', () => {
  it('keys champions and spells by the numeric ids match data uses', async () => {
    const manifest = await buildAssetManifest(fakeFetch)

    expect(manifest.version).toBe('16.16.1')
    expect(manifest.cdn).toBe(CDN)
    // The image name is the string id, which is not always the display name.
    expect(manifest.championById[62]).toEqual({ id: 'MonkeyKing', name: 'Wukong' })
    expect(manifest.spellById[4]).toEqual({ id: 'SummonerFlash', name: 'Flash' })
  })

  it('files rune trees and the runes inside them in one lookup', async () => {
    const manifest = await buildAssetManifest(fakeFetch)

    expect(manifest.runeById[8100].name).toBe('Domination')
    expect(manifest.runeById[8112]).toEqual({ icon: 'perk-images/Electrocute.png', name: 'Electrocute' })
  })

  it('leaves TFT out rather than failing when Data Dragon has none of its files', async () => {
    const manifest = await buildAssetManifest(fakeFetch)
    expect(manifest.tft).toBeUndefined()
  })

  it("keys TFT's lookups by the ids match data sends, lower-cased, and keeps what one missing file leaves", async () => {
    const withTft = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('tft-champion.json')) {
        return new Response(
          JSON.stringify({
            data: {
              'Maps/Shipping/Map22/Sets/TFTSet18/Shop/TFT18_Jinx': {
                id: 'TFT18_Jinx',
                name: 'Jinx',
                tier: 4,
                image: { full: 'TFT18_Jinx.TFT_Set18.png', group: 'tft-champion' }
              }
            }
          })
        )
      }
      if (url.endsWith('tft-trait.json')) {
        return new Response(
          JSON.stringify({ data: { x: { id: 'TFT18_FloraFatalis', name: 'Flora Fatalis', image: { full: 'Trait.png', group: 'tft-trait' } } } })
        )
      }
      if (url.endsWith('tft-item.json')) return new Response('gone', { status: 503 })
      return fakeFetch(input)
    }) as typeof fetch

    const manifest = await buildAssetManifest(withTft)

    expect(manifest.tft?.units['tft18_jinx']).toEqual({
      name: 'Jinx',
      cost: 4,
      image: `${CDN}/16.16.1/img/tft-champion/TFT18_Jinx.TFT_Set18.png`
    })
    expect(manifest.tft?.traits['tft18_florafatalis']?.name).toBe('Flora Fatalis')
    expect(manifest.tft?.items).toEqual({})
    expect(manifest.championById[62]?.name).toBe('Wukong')
  })

  it('fails with the address that failed, rather than half a manifest', async () => {
    const broken = (async (input: string | URL | Request) =>
      String(input).endsWith('summoner.json')
        ? new Response('gone', { status: 503 })
        : fakeFetch(input)) as typeof fetch

    await expect(buildAssetManifest(broken)).rejects.toThrow(/Data Dragon 503 for .*summoner\.json/)
  })
})
