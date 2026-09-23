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

  it('encodes a Riot ID into the search query', async () => {
    const { calls, request } = recorder(() => ({}))
    const api = createServerApi(request)

    await api.search.summoner({ gameName: 'Hide on bush', tagLine: 'KR1' })

    expect(calls[0].path).toBe('/search?gameName=Hide%20on%20bush&tagLine=KR1')
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
