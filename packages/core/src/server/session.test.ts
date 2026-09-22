import { describe, expect, it, vi } from 'vitest'
import { ServerError } from './errors'
import { createServerSession, type SessionStore } from './session'

const USER = { id: 'u1', username: 'Faker', email: 'faker@example.com', isAdmin: false }

/** A session answer whose access token expires `inMs` from now. */
function session(token: string, inMs: number, refreshToken: string | undefined = `r-${token}`) {
  return {
    accessToken: token,
    accessTokenExpiresAt: new Date(Date.now() + inMs).toISOString(),
    ...(refreshToken === undefined ? {} : { refreshToken }),
    user: USER
  }
}

interface Call {
  path: string
  method: string
  body: unknown
  headers: Record<string, string>
}

/**
 * A server in a box: routes answered in order, every call recorded.
 *
 * Each route takes a queue of answers so a test can say "the first refresh is
 * refused, the second succeeds" without a mock framework in the way.
 */
function fakeServer(routes: Record<string, Array<() => Response>>) {
  const calls: Call[] = []

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    calls.push({
      path: url.pathname,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>
    })

    const queue = routes[key]
    const next = queue?.length ? (queue.length > 1 ? queue.shift()! : queue[0]) : undefined
    if (!next) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    return next()
  }) as unknown as typeof fetch

  return { calls, fetch: fetchImpl }
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status })

function memoryStore(initial: string | null = 'r-0'): SessionStore & { value: string | null } {
  return {
    value: initial,
    load() {
      return this.value
    },
    save(token) {
      this.value = token
    },
    clear() {
      this.value = null
    }
  }
}

const DESKTOP = { kind: 'desktop', version: '0.12.0' } as const

describe('createServerSession', () => {
  it('renews before a request rather than after a 401, and keeps the rotated token', async () => {
    const store = memoryStore('r-0')
    const server = fakeServer({
      'POST /auth/refresh': [json(session('a-1', 15 * 60_000, 'r-1'))],
      'GET /riot-accounts': [json([])]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store,
      fetch: server.fetch
    })

    await s.request('/riot-accounts')

    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /auth/refresh',
      'GET /riot-accounts'
    ])
    expect(server.calls[0].body).toEqual({ refreshToken: 'r-0' })
    expect(server.calls[1].headers.Authorization).toBe('Bearer a-1')
    expect(store.value).toBe('r-1')
  })

  it('spends a refresh token once however many requests are waiting on it', async () => {
    // The race this exists to prevent: three screens load together as the token
    // lapses, each renews, and the second renewal presents a token the first
    // already spent — which the server treats as theft and answers by signing
    // the person out everywhere.
    const server = fakeServer({
      'POST /auth/refresh': [json(session('a-1', 15 * 60_000, 'r-1'))],
      'GET /riot-accounts': [json([])],
      'GET /seasons': [json([])],
      'GET /sync/1': [json(null)]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store: memoryStore(),
      fetch: server.fetch
    })

    await Promise.all([s.request('/riot-accounts'), s.request('/seasons'), s.request('/sync/1')])

    expect(server.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1)
  })

  it('reuses a live token without asking again', async () => {
    const server = fakeServer({
      'POST /auth/login': [json(session('a-1', 15 * 60_000))],
      'GET /seasons': [json([])]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store: memoryStore(null),
      fetch: server.fetch
    })

    await s.login({ email: 'faker@example.com', password: 'correct horse battery' })
    await s.request('/seasons')
    await s.request('/seasons')

    expect(server.calls.map((c) => c.path)).toEqual(['/auth/login', '/seasons', '/seasons'])
  })

  it('renews and retries once when a token that looked live is refused', async () => {
    const server = fakeServer({
      'POST /auth/login': [json(session('a-1', 15 * 60_000))],
      'POST /auth/refresh': [json(session('a-2', 15 * 60_000))],
      'GET /seasons': [json({ error: 'unauthorized' }, 401), json([])]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store: memoryStore(null),
      fetch: server.fetch
    })

    await s.login({ email: 'faker@example.com', password: 'correct horse battery' })
    await expect(s.request('/seasons')).resolves.toEqual([])

    const seasons = server.calls.filter((c) => c.path === '/seasons')
    expect(seasons.map((c) => c.headers.Authorization)).toEqual(['Bearer a-1', 'Bearer a-2'])
  })

  it('signs out for good when the server refuses a renewal, and does not ask twice', async () => {
    const store = memoryStore('r-dead')
    const onSignedOut = vi.fn()
    const server = fakeServer({
      'POST /auth/refresh': [json({ error: 'invalid_refresh_token' }, 401)]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store,
      fetch: server.fetch,
      onSignedOut
    })

    await expect(s.request('/seasons')).rejects.toMatchObject({ status: 401 })
    await expect(s.request('/seasons')).rejects.toMatchObject({ status: 401 })

    expect(onSignedOut).toHaveBeenCalledTimes(1)
    expect(store.value).toBeNull()
    // The second request found no credential and never reached the network.
    expect(server.calls).toHaveLength(1)
  })

  it('reports a build the server will not serve, with the version it wants', async () => {
    const onUpgradeRequired = vi.fn()
    const server = fakeServer({
      'POST /auth/login': [json(session('a-1', 15 * 60_000))],
      'GET /seasons': [
        json(
          { error: 'unsupported_client', message: 'This server needs Foxfire 0.13.0.', recommendedDesktop: '0.13.0' },
          426
        )
      ]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store: memoryStore(null),
      fetch: server.fetch,
      onUpgradeRequired
    })

    await s.login({ email: 'faker@example.com', password: 'correct horse battery' })
    const refused = await s.request('/seasons').catch((err: unknown) => err)

    expect(refused).toBeInstanceOf(ServerError)
    expect((refused as ServerError).upgradeTo).toBe('0.13.0')
    expect(onUpgradeRequired).toHaveBeenCalledWith('0.13.0')
  })

  it('tells the server it is a desktop, and which one, on every request', async () => {
    const server = fakeServer({ 'POST /auth/login': [json(session('a-1', 15 * 60_000))] })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store: memoryStore(null),
      fetch: server.fetch,
      deviceLabel: 'DESKTOP-FOX'
    })

    await s.login({ email: 'faker@example.com', password: 'correct horse battery' })

    expect(server.calls[0].headers['X-Foxfire-Client']).toBe('0.12.0')
    expect(server.calls[0].body).toMatchObject({ deviceLabel: 'DESKTOP-FOX' })
  })

  it('puts every path under the API base', async () => {
    const server = fakeServer({
      'POST /api/auth/login': [json(session('a-1', 15 * 60_000))],
      'GET /api/seasons': [json([])]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      basePath: '/api',
      identity: DESKTOP,
      tokenTransport: 'body',
      store: memoryStore(null),
      fetch: server.fetch
    })

    await s.login({ email: 'faker@example.com', password: 'correct horse battery' })
    await s.request('/seasons')

    expect(server.calls.map((c) => c.path)).toEqual(['/api/auth/login', '/api/seasons'])
  })

  it('keeps its hands off a cookie it cannot see', async () => {
    // Cookie mode: nothing to load, nothing to send, and nothing written down —
    // the browser carries the refresh token and the page never learns it.
    const server = fakeServer({
      'POST /api/auth/refresh': [json(session('a-1', 15 * 60_000, undefined))],
      'GET /api/seasons': [json([])]
    })

    const s = createServerSession({
      baseUrl: '',
      basePath: '/api',
      identity: { kind: 'web', apiVersion: 1 },
      tokenTransport: 'cookie',
      fetch: (input, init) => server.fetch(new URL(String(input), 'https://fox.example'), init)
    })

    await expect(s.restore()).resolves.toEqual(USER)
    await s.request('/seasons')

    expect(server.calls[0].body).toBeUndefined()
    expect(server.calls[0].headers['X-Foxfire-Client']).toBe('web')
    expect(server.calls[0].headers['X-Foxfire-Api-Version']).toBe('1')
  })

  it('answers restore with nobody when there is no session to resume', async () => {
    const server = fakeServer({ 'POST /api/auth/refresh': [json({ error: 'no_session' }, 401)] })

    const s = createServerSession({
      baseUrl: '',
      basePath: '/api',
      identity: { kind: 'web', apiVersion: 1 },
      tokenTransport: 'cookie',
      fetch: (input, init) => server.fetch(new URL(String(input), 'https://fox.example'), init)
    })

    await expect(s.restore()).resolves.toBeNull()
  })

  it('signs out locally even when the server cannot be told', async () => {
    const store = memoryStore(null)
    const server = fakeServer({
      'POST /auth/login': [json(session('a-1', 15 * 60_000, 'r-1'))],
      'POST /auth/logout': [() => new Response('upstream down', { status: 502 })]
    })

    const s = createServerSession({
      baseUrl: 'https://fox.example',
      identity: DESKTOP,
      tokenTransport: 'body',
      store,
      fetch: server.fetch
    })

    await s.login({ email: 'faker@example.com', password: 'correct horse battery' })
    expect(store.value).toBe('r-1')

    await s.logout()

    expect(server.calls.at(-1)?.body).toEqual({ refreshToken: 'r-1' })
    expect(store.value).toBeNull()
    expect(s.user()).toBeNull()
  })
})
