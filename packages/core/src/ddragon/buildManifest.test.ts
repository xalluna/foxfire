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

  it('fails with the address that failed, rather than half a manifest', async () => {
    const broken = (async (input: string | URL | Request) =>
      String(input).endsWith('summoner.json')
        ? new Response('gone', { status: 503 })
        : fakeFetch(input)) as typeof fetch

    await expect(buildAssetManifest(broken)).rejects.toThrow(/Data Dragon 503 for .*summoner\.json/)
  })
})
