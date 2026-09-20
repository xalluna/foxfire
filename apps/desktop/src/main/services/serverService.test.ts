import { beforeEach, describe, expect, it, vi } from 'vitest'

// Everything this module reaches for at import time. The logger opens a file
// under app.getPath and the hub opens a socket; neither is what is under test.
vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} })
}))
vi.mock('../server/hub', () => ({ connectHub: () => {}, disconnectHub: () => {} }))
vi.mock('../ipc/broadcast', () => ({ broadcast: () => {} }))
vi.mock('../db', () => ({ getDb: () => ({}) }))

const settings = new Map<string, string>()
vi.mock('../db/repositories/appSettings.repo', () => ({
  getSetting: (_db: unknown, key: string) => settings.get(key) ?? null,
  setSetting: (_db: unknown, key: string, value: string) => void settings.set(key, value)
}))

// A remembered server is only a session when there is a refresh token for it.
const secrets = new Map<string, string>()
vi.mock('../security/keyStore', () => ({
  loadSecret: (name: string) => secrets.get(name) ?? null,
  saveSecret: (name: string, value: string) => void secrets.set(name, value),
  clearSecret: (name: string) => void secrets.delete(name)
}))

const { getServerState } = await import('./serverService')

const URL = 'http://localhost:8080'

function remember(server: Record<string, unknown>): void {
  settings.set('server.known', JSON.stringify([{ url: URL, name: 'The Fox Den', ...server }]))
  settings.set('server.active', URL)
  secrets.set(`server-${URL}`, 'a-refresh-token')
}

/**
 * Who the desktop thinks you are on the active server.
 *
 * Worth testing because of what it gates and how quietly it failed. isAdmin was
 * a hardcoded false here for the whole of Phase 2 and 3 — the sign-in response
 * carried the real answer and this threw it away — so the Settings sidebar
 * asked "is this person an admin", was told no, and never offered the user
 * management or storage pages to anybody on any server. Nothing errored. The
 * pages simply were not there, which looks like a feature that was never built
 * rather than one that was.
 */
describe('getServerState', () => {
  beforeEach(() => {
    settings.clear()
    secrets.clear()
  })

  it('reports the admin flag the server gave us', () => {
    remember({ username: 'Faker', email: 'faker@example.com', isAdmin: true })

    const { session } = getServerState()

    expect(session?.isAdmin).toBe(true)
    expect(session?.email).toBe('faker@example.com')
    expect(session?.username).toBe('Faker')
  })

  it('reports an ordinary member as one', () => {
    remember({ username: 'Chovy', email: 'chovy@example.com', isAdmin: false })

    expect(getServerState().session?.isAdmin).toBe(false)
  })

  it('treats a server remembered before this was stored as not an admin', () => {
    // The safe direction. A row written by an older build has neither field,
    // and offering admin pages whose every call would 403 is worse than
    // waiting for the next token renewal to fill them in.
    remember({ username: 'Faker' })

    const { session } = getServerState()

    expect(session?.isAdmin).toBe(false)
    expect(session?.email).toBe('')
  })

  it('has no session at all once the credentials are gone', () => {
    remember({ username: 'Faker', isAdmin: true })
    secrets.clear()

    expect(getServerState().session).toBeNull()
  })
})
