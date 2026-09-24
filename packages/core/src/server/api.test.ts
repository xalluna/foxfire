import { describe, expect, it } from 'vitest'
import { createServerApi, type AuthedRequest } from './api'
import { ServerError } from './errors'

/** Records what was asked for, and answers with whatever the test hands it. */
function recorder(answer: (path: string) => unknown = () => undefined) {
  const calls: Array<{ path: string; method: string; body: unknown }> = []

  const request = (async (path: string, init: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: init.method ?? 'GET', body: init.body })
    const result = answer(path)
    if (result instanceof Error) throw result
    return result
  }) as AuthedRequest

  return { calls, request }
}

describe('createServerApi', () => {
  it('leaves the queue off a match page that means every queue', async () => {
    const { calls, request } = recorder(() => [])
    const api = createServerApi(request)

    await api.dashboard.matches('acc-1', 20, 40, null)
    await api.dashboard.matches('acc-1', 20, 0, 420)

    expect(calls.map((c) => c.path)).toEqual([
      '/riot-accounts/acc-1/matches?limit=20&offset=40',
      '/riot-accounts/acc-1/matches?limit=20&offset=0&queueId=420'
    ])
  })

  it('returns the fresh editable list after a hand-entered edit', async () => {
    const { calls, request } = recorder((path) => (path.includes('/rank/editable') ? ['still-open'] : undefined))
    const api = createServerApi(request)

    const left = await api.rank.saveManual('acc-1', 'RANKED_SOLO_5x5', [])

    expect(left).toEqual(['still-open'])
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /riot-accounts/acc-1/rank/manual',
      'GET /riot-accounts/acc-1/rank/editable?queueType=RANKED_SOLO_5x5'
    ])
  })

  it('answers a refused admin write with the server\'s own message', async () => {
    const { request } = recorder(
      () => new ServerError('There has to be at least one administrator.', 409, 'last_admin')
    )
    const api = createServerApi(request)

    await expect(api.admin.updateUser('u1', { isAdmin: false })).resolves.toEqual({
      ok: false,
      error: 'There has to be at least one administrator.'
    })
  })

  it('lets a failed read throw, because a read that fails has nothing to show', async () => {
    const { request } = recorder(() => new ServerError('Forbidden', 403))
    const api = createServerApi(request)

    await expect(api.admin.users()).rejects.toBeInstanceOf(ServerError)
  })

  it('encodes a finder query, hash and all', async () => {
    const { calls, request } = recorder(() => [])
    const api = createServerApi(request)

    await api.search.players('Hide on bush#KR1')

    expect(calls[0].path).toBe('/search?q=Hide%20on%20bush%23KR1')
  })

  it('leaves the page to the server when a blank query names none', async () => {
    const { calls, request } = recorder(() => [])
    const api = createServerApi(request)

    await api.search.players('')

    expect(calls[0].path).toBe('/search?q=')
  })

  it('asks the finder for a page, and for only yours or only the claimed', async () => {
    const { calls, request } = recorder(() => [])
    const api = createServerApi(request)

    await api.search.players('', { limit: 50, offset: 100 })
    await api.search.players('', { mine: true })
    await api.search.players('fak', { claimed: true, limit: 50, offset: 0 })

    expect(calls.map((c) => c.path)).toEqual([
      '/search?q=&limit=50&offset=100',
      '/search?q=&mine=true',
      '/search?q=fak&claimed=true&limit=50&offset=0'
    ])
  })

  it('asks for the members a page at a time, by name or address', async () => {
    const { calls, request } = recorder(() => ({ items: [], total: 0 }))
    const api = createServerApi(request)

    await api.admin.users()
    await api.admin.users({ q: '  Faker@Example.com ', limit: 50, offset: 50 })
    await api.admin.users({ q: '   ' })

    expect(calls.map((c) => c.path)).toEqual([
      '/admin/users/',
      '/admin/users/?q=Faker%40Example.com&limit=50&offset=50',
      '/admin/users/'
    ])
  })

  it('asks for the open invites whole and the used ones a page at a time', async () => {
    const { calls, request } = recorder(() => [])
    const api = createServerApi(request)

    await api.admin.openInvites()
    await api.admin.usedInvites()
    await api.admin.usedInvites({ limit: 50, offset: 100 })

    expect(calls.map((c) => c.path)).toEqual([
      '/admin/invites/',
      '/admin/invites/used',
      '/admin/invites/used?limit=50&offset=100'
    ])
  })

  it('asks for the replay library a page at a time', async () => {
    const { calls, request } = recorder(() => ({ items: [], total: 0 }))
    const api = createServerApi(request)

    await api.admin.storedReplays()
    await api.admin.storedReplays({ limit: 50, offset: 50 })

    expect(calls.map((c) => c.path)).toEqual([
      '/admin/storage/replays',
      '/admin/storage/replays?limit=50&offset=50'
    ])
  })

  it('hands a page back as the server sent it, total and all', async () => {
    const page = { items: [{ matchId: 'NA1_1' }], total: 37 }
    const { request } = recorder(() => page)
    const api = createServerApi(request)

    await expect(api.dashboard.matches('acc-1', 20, 0, null)).resolves.toEqual(page)
    await expect(api.search.players('')).resolves.toEqual(page)
  })

  it('reads accounts one question at a time, never the whole server', async () => {
    const { calls, request } = recorder(() => [])
    const api = createServerApi(request)

    await api.accounts.mine()
    await api.accounts.get('acc-1')
    await api.accounts.find({ gameName: 'Hide on bush', tagLine: 'KR1' })

    expect(calls.map((c) => c.path)).toEqual([
      '/riot-accounts/mine',
      '/riot-accounts/acc-1',
      '/riot-accounts/lookup?gameName=Hide%20on%20bush&tagLine=KR1'
    ])
  })

  it('answers an account the server does not have with null', async () => {
    const { request } = recorder(() => new ServerError('The server answered 404.', 404))
    const api = createServerApi(request)

    await expect(api.accounts.get('gone')).resolves.toBeNull()
    await expect(api.accounts.find({ gameName: 'Nobody', tagLine: 'NA1' })).resolves.toBeNull()
  })

  describe('importer', () => {
    it('answers null, rather than failing, from a server too old to be asked which games it lacks', async () => {
      // An unknown route on the API is a 404, and that is an answer: the import
      // sends everything instead, which the matches batch de-duplicates.
      const { request } = recorder(() => new ServerError('The server answered 404.', 404))
      const api = createServerApi(request)

      await expect(api.importer.unstoredMatches(['NA1_1'])).resolves.toBeNull()
    })

    it('still lets a real failure through when asked which games the server lacks', async () => {
      // Only "there is no such route" means send everything. A 403 is a person
      // who is not an administrator, and pretending otherwise would send a year
      // of payloads at a server that is going to refuse every one of them.
      const { request } = recorder(() => new ServerError('Forbidden', 403))
      const api = createServerApi(request)

      await expect(api.importer.unstoredMatches(['NA1_1'])).rejects.toBeInstanceOf(ServerError)
    })

    it('fills in the counts a server older than the change leaves out', async () => {
      // One that predates counting sent only what it accepted, and one that
      // predates `unplaced` counted those as skipped. Nothing downstream should
      // have to wonder which it is talking to.
      const { request } = recorder(() => ({ accepted: 3 }))
      const api = createServerApi(request)

      await expect(api.importer.rankReadings([])).resolves.toEqual({
        accepted: 3,
        skipped: 0,
        failed: 0,
        unplaced: 0
      })
    })

    it('passes along all four counts from a server that sends them', async () => {
      const { request } = recorder(() => ({ accepted: 1, skipped: 2, failed: 3, unplaced: 4 }))
      const api = createServerApi(request)

      await expect(api.importer.matches([])).resolves.toEqual({
        accepted: 1,
        skipped: 2,
        failed: 3,
        unplaced: 4
      })
    })
  })
})
