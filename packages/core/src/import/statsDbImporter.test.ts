import { describe, expect, it } from 'vitest'
import type { ImportProgress } from '../types'
import { IMPORT_BATCH, importStatsDb, type ImportTarget, type SqliteReader } from './statsDbImporter'
import type { ImportAccountRow, ImportMatchRow, ImportReadingRow, ImportSeasonRow } from './rows'

/**
 * A stats.db without SQLite: tables as arrays, answering exactly the queries
 * the importer asks. A query it was not written for fails the test loudly,
 * which is the point — a changed query here should be a deliberate change.
 */
function fakeDb(tables: {
  accounts?: Array<{ id: number; puuid: string; game_name: string; tag_line: string; platform: string | null }>
  seasons?: Array<{ label: string; starts_at: number; is_preseason: number; resets_rank: number }>
  matches?: Array<{ match_id: string; raw_json: string; game_creation: number }>
  rank_snapshots?: Array<Record<string, unknown> & { account_id: number; captured_at: number; id: number }>
}): SqliteReader {
  const has = (name: string) => (tables as Record<string, unknown>)[name] !== undefined

  return {
    get: (sql, params = []) => {
      if (sql.includes('sqlite_master')) return (has(String(params[0])) ? { present: 1 } : undefined) as never
      const counted = /COUNT\(\*\) AS n FROM (\w+)/.exec(sql)
      if (counted) return { n: ((tables as Record<string, unknown[]>)[counted[1]] ?? []).length } as never
      throw new Error(`unexpected get: ${sql}`)
    },

    all: (sql, params = []) => {
      const [limit, offset] = params.map(Number)
      if (sql.includes('FROM accounts')) return (tables.accounts ?? []) as never[]
      if (sql.includes('FROM seasons')) return (tables.seasons ?? []) as never[]
      if (sql.includes('FROM matches')) {
        return [...(tables.matches ?? [])]
          .sort((a, b) => a.game_creation - b.game_creation)
          .slice(offset, offset + limit) as never[]
      }
      if (sql.includes('FROM rank_snapshots')) {
        const byId = new Map((tables.accounts ?? []).map((a) => [a.id, a.puuid]))
        return (tables.rank_snapshots ?? [])
          .map((s) => ({ ...s, puuid: byId.get(s.account_id) }))
          .slice(offset, offset + limit) as never[]
      }
      throw new Error(`unexpected all: ${sql}`)
    }
  }
}

/** The server's side: records every batch, in order, and answers as a server would. */
function recordingTarget(options: { unresolved?: string[]; failMatches?: boolean } = {}) {
  const calls: string[] = []
  const sent = {
    accounts: [] as ImportAccountRow[],
    seasons: [] as ImportSeasonRow[],
    matches: [] as ImportMatchRow[],
    readings: [] as ImportReadingRow[]
  }

  const target: ImportTarget = {
    accounts: async (rows) => {
      calls.push(`accounts:${rows.length}`)
      sent.accounts.push(...rows)
      return rows.map((row) => {
        const riotId = `${row.gameName}#${row.tagLine}`
        const resolved = !options.unresolved?.includes(riotId)
        return { riotId, accountId: resolved ? `id-${row.puuid}` : null, resolved, message: null }
      })
    },
    seasons: async (rows) => {
      calls.push(`seasons:${rows.length}`)
      sent.seasons.push(...rows)
      return { accepted: rows.length }
    },
    matches: async (rows) => {
      if (options.failMatches) throw new Error('The server refused a page of matches.')
      calls.push(`matches:${rows.length}`)
      sent.matches.push(...rows)
      return { accepted: rows.length }
    },
    rankReadings: async (rows) => {
      calls.push(`readings:${rows.length}`)
      sent.readings.push(...rows)
      return { accepted: rows.length }
    },
    finish: async () => {
      calls.push('finish')
      return { accounts: sent.accounts.length, attributed: 3 }
    }
  }

  return { target, calls, sent }
}

const ACCOUNTS = [
  { id: 1, puuid: 'p-faker', game_name: 'Faker', tag_line: 'KR1', platform: 'kr' },
  { id: 2, puuid: 'p-chovy', game_name: 'Chovy', tag_line: 'KR1', platform: 'kr' }
]

describe('importStatsDb', () => {
  it('sends accounts first, then seasons, matches, readings, and asks for LP last', async () => {
    const db = fakeDb({
      accounts: ACCOUNTS,
      seasons: [{ label: 'S2026', starts_at: 1_000, is_preseason: 0, resets_rank: 1 }],
      matches: [{ match_id: 'KR_1', raw_json: '{}', game_creation: 5 }],
      rank_snapshots: [
        { id: 1, account_id: 1, captured_at: 10, queue_type: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', league_points: 40, wins: 1, losses: 0, source: 'lcu', match_id: null }
      ]
    })
    const { target, calls, sent } = recordingTarget()

    const result = await importStatsDb(db, target, () => {})

    expect(calls).toEqual(['accounts:2', 'seasons:1', 'matches:1', 'readings:1', 'finish'])
    expect(result).toMatchObject({ ok: true, accounts: 2, seasons: 1, matches: 1, readings: 1, attributed: 3 })

    // The shapes the server reads, spelled the way it reads them.
    expect(sent.accounts[0]).toEqual({ gameName: 'Faker', tagLine: 'KR1', platform: 'kr', puuid: 'p-faker' })
    expect(sent.seasons[0]).toEqual({ label: 'S2026', startsAt: 1_000, isPreseason: false, resetsRank: true })
    expect(sent.readings[0]).toMatchObject({ puuid: 'p-faker', division: 'II', leaguePoints: 40, capturedAt: 10 })
  })

  it('pages matches so a year of history is a few dozen requests rather than one enormous one', async () => {
    const matches = Array.from({ length: IMPORT_BATCH * 2 + 5 }, (_, i) => ({
      match_id: `KR_${i}`,
      raw_json: '{}',
      game_creation: i
    }))
    const { target, calls, sent } = recordingTarget()

    await importStatsDb(fakeDb({ accounts: ACCOUNTS, matches }), target, () => {})

    expect(calls.filter((c) => c.startsWith('matches:'))).toEqual([
      `matches:${IMPORT_BATCH}`,
      `matches:${IMPORT_BATCH}`,
      'matches:5'
    ])
    // Oldest first, as the file stores them.
    expect(sent.matches[0].matchId).toBe('KR_0')
  })

  it('names the accounts the server could not resolve rather than counting them', async () => {
    const { target } = recordingTarget({ unresolved: ['Chovy#KR1'] })

    const result = await importStatsDb(fakeDb({ accounts: ACCOUNTS, matches: [] }), target, () => {})

    expect(result.accounts).toBe(1)
    expect(result.unresolved).toEqual(['Chovy#KR1'])
  })

  it('reports each phase as it goes, ending on done', async () => {
    const phases: ImportProgress['phase'][] = []
    const { target } = recordingTarget()

    await importStatsDb(
      fakeDb({ accounts: ACCOUNTS, matches: [{ match_id: 'KR_1', raw_json: '{}', game_creation: 1 }] }),
      target,
      (progress) => phases.push(progress.phase)
    )

    expect([...new Set(phases)]).toEqual(['accounts', 'matches', 'finishing', 'done'])
  })

  it('refuses a file with no Foxfire tables in it before sending anything', async () => {
    const { target, calls } = recordingTarget()

    const result = await importStatsDb(fakeDb({}), target, () => {})

    expect(result).toMatchObject({ ok: false, message: 'That database has no Foxfire tables in it.' })
    expect(calls).toEqual([])
  })

  it('answers a failure part-way with why, rather than throwing at the panel', async () => {
    const { target } = recordingTarget({ failMatches: true })

    const result = await importStatsDb(
      fakeDb({ accounts: ACCOUNTS, matches: [{ match_id: 'KR_1', raw_json: '{}', game_creation: 1 }] }),
      target,
      () => {}
    )

    expect(result).toMatchObject({ ok: false, message: 'The server refused a page of matches.' })
  })
})
