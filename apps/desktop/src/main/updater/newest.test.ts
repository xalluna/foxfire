import { describe, expect, it, vi } from 'vitest'
import { desktopVersionFromTag, newestDesktopVersion } from './newest'
import { feedUrl, releasePageUrl } from './feed'

const answering = (body: unknown, ok = true): typeof fetch =>
  vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }) as unknown as typeof fetch

describe('desktopVersionFromTag', () => {
  it('reads the version out of a desktop tag', () => {
    expect(desktopVersionFromTag('desktop-v0.14.0')).toBe('0.14.0')
  })

  it('ignores a server release holding the Latest badge', () => {
    expect(desktopVersionFromTag('server-v0.2.1')).toBeNull()
  })

  it('ignores the old bare spelling, which predates every build that asks', () => {
    expect(desktopVersionFromTag('v0.11.0')).toBeNull()
  })

  it('ignores anything that is not three numbers', () => {
    expect(desktopVersionFromTag('desktop-v0.14')).toBeNull()
    expect(desktopVersionFromTag('desktop-vnext')).toBeNull()
    expect(desktopVersionFromTag('')).toBeNull()
  })
})

describe('newestDesktopVersion', () => {
  it('asks the releases page for JSON and reads the tag', async () => {
    const fetchImpl = answering({ tag_name: 'desktop-v0.15.0' })
    await expect(newestDesktopVersion(fetchImpl)).resolves.toBe('0.15.0')

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(url).toBe('https://github.com/xalluna/foxfire/releases/latest')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })

  it('has no answer when GitHub refuses', async () => {
    await expect(newestDesktopVersion(answering({}, false))).resolves.toBeNull()
  })

  it('has no answer when the body carries no tag', async () => {
    await expect(newestDesktopVersion(answering({ id: 1 }))).resolves.toBeNull()
  })
})

describe('feedUrl', () => {
  it('points at one release\u2019s assets, with the version in the path', () => {
    expect(feedUrl('0.15.0', undefined)).toBe(
      'https://github.com/xalluna/foxfire/releases/download/desktop-v0.15.0'
    )
  })

  it('takes a rehearsal feed from the environment when one is set', () => {
    expect(feedUrl('0.15.0', 'http://localhost:8080')).toBe('http://localhost:8080')
  })

  it('links to the release page for the version it names', () => {
    expect(releasePageUrl('0.15.0')).toBe(
      'https://github.com/xalluna/foxfire/releases/tag/desktop-v0.15.0'
    )
  })
})
