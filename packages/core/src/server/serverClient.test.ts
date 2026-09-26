import { describe, expect, it, vi } from 'vitest'
import type { Account, AssetManifest } from '../types'
import { createServerClient } from './serverClient'
import { createServerSession } from './session'

const WEB = { kind: 'web', apiVersion: 1 } as const
const USER = { id: 'u1', username: 'Faker', email: 'faker@example.com', isAdmin: true, isHeadAdmin: true }

const VERSION = {
  serverName: 'The Fox Den',
  serverVersion: '0.2.0',
  apiVersion: 1,
  minimumDesktop: '0.12.0',
  recommendedDesktop: '0.12.0',
  publicSignup: true,
  apiBase: '/api',
  publicUrl: 'https://fox.example'
}

function account(id: string, isMine: boolean): Account {
  return { id, gameName: `Player${id}`, tagLine: 'NA1', isMine, isHomeAccount: false } as unknown as Account
}

interface Call {
  method: string
  path: string
  body: unknown
}

/** A server in a box that answers from the page's own origin, as the web client's does. */
function fakeServer(routes: Record<string, () => Response>) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'https://fox.example')
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined })

    const route = routes[`${method} ${url.pathname}`]
    return route ? route() : new Response(JSON.stringify({ error: 'not_found', message: 'No.' }), { status: 404 })
  }) as unknown as typeof fetch
  return { calls, fetch: fetchImpl }
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status })

function webClient(routes: Record<string, () => Response>) {
  const server = fakeServer({
    'POST /api/auth/refresh': json({
      accessToken: 'a-1',
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      user: USER
    }),
    'GET /version': json(VERSION),
    'GET /health': json({ status: 'healthy', riotKeyRejected: false, queueDepth: 0 }),
    ...routes
  })

  const session = createServerSession({
    baseUrl: '',
    basePath: '/api',
    identity: WEB,
    tokenTransport: 'cookie',
    fetch: server.fetch
  })

  let home: string | null = null
  let favorites: string | null = null
  const client = createServerClient({
    session,
    identity: WEB,
    home: { get: () => home, set: (id) => (home = id) },
    favorites: { get: () => favorites, set: (list) => (favorites = list) },
    assets: async () => ({}) as AssetManifest
  })

  return { server, session, client, remember: (id: string | null) => (home = id) }
}

describe('createServerClient', () => {
  it("reads the connection from the server's handshake, its health and who is signed in", async () => {
    const { client, session, server } = webClient({})

    await session.restore()
    const state = await client.connection.get()

    expect(state).toEqual({
      mode: 'server',
      publicUrl: 'https://fox.example',
      serverName: 'The Fox Den',
      session: { username: 'Faker', email: 'faker@example.com', isAdmin: true, isHeadAdmin: true },
      riotKeyRejected: false,
      upgradeRequired: null
    })

    // The cookie is the credential: a browser's refresh sends no body at all.
    const refresh = server.calls.find((c) => c.path === '/api/auth/refresh')
    expect(refresh?.body).toBeUndefined()
  })

  it('tells every screen once when the server stops serving this page', () => {
    const { client } = webClient({})
    const seen = vi.fn()
    client.connection.onChanged(seen)

    client.markUpgradeRequired()
    client.markUpgradeRequired()

    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0].upgradeRequired).toBe('reload')
  })

  it('keeps favorites in its own store, without asking the server anything', async () => {
    const { client, server } = webClient({})

    const outcome = await client.favorites.add({ account: account('9', false), soloEntry: null })
    const list = await client.favorites.list()

    expect(outcome.ok).toBe(true)
    expect(list.map((f) => f.account.id)).toEqual(['9'])
    expect(server.calls).toEqual([])
  })

  it("opens on nobody rather than a stranger's profile when nothing is yours", async () => {
    const { client, session, server } = webClient({
      'GET /api/riot-accounts/mine': json([])
    })
    await session.restore()

    await expect(client.accounts.getHome()).resolves.toBeNull()

    // Nor does it go looking for one: nothing asks for every account.
    expect(server.calls.some((c) => c.path === '/api/riot-accounts')).toBe(false)
  })

  it('opens on the account it remembers, even when that account is somebody else', async () => {
    const { client, session, remember } = webClient({
      'GET /api/riot-accounts/friend': json(account('friend', false)),
      'GET /api/riot-accounts/mine': json([account('1', true)])
    })
    await session.restore()
    remember('friend')

    const home = await client.accounts.getHome()
    const mine = await client.accounts.mine()

    expect(home?.id).toBe('friend')
    expect(home?.isHomeAccount).toBe(true)

    // The rail is yours, and a friend's profile is not in it to be marked.
    expect(mine.some((a) => a.isHomeAccount)).toBe(false)
  })

  it('opens on your own first account when the remembered one has gone', async () => {
    const { client, session, remember } = webClient({
      'GET /api/riot-accounts/mine': json([account('1', true), account('2', true)])
    })
    await session.restore()
    remember('deleted')

    await expect(client.accounts.getHome()).resolves.toMatchObject({ id: '1', isHomeAccount: true })
  })

  it('answers an account nobody here plays as with null, not an error', async () => {
    const { client, session } = webClient({})
    await session.restore()

    await expect(client.accounts.find({ gameName: 'Nobody', tagLine: 'NA1' })).resolves.toBeNull()
  })

  it('answers a game the server does not hold for that player with null, not an error', async () => {
    const { client, session } = webClient({})
    await session.restore()

    await expect(client.dashboard.matchSummary?.('acc-1', 'NA1_404')).resolves.toBeNull()
  })
})
