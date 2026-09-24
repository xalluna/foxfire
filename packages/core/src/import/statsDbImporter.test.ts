import { describe, expect, it } from 'vitest'
import type { ImportProgress } from '../types'
import {
  IMPORT_BATCH,
  IMPORT_ID_PAGE,
  importStatsDb,
  type ImportTarget,
  type SqliteReader
} from './statsDbImporter'
import type {
  ImportAccountRow,
  ImportBatchOutcome,
  ImportMatchRow,
  ImportReadingRow,
  ImportSeasonRow
} from './rows'

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

      const newest = /MAX\((\w+)\) AS newest FROM (\w+)/.exec(sql)
      if (newest) {
        const rows = (tables as Record<string, Array<Record<string, number>>>)[newest[2]] ?? []
        return { newest: rows.length === 0 ? null : Math.max(...rows.map((r) => r[newest[1]])) } as never
      }

      throw new Error(`unexpected get: ${sql}`)
    },

    all: (sql, params = []) => {
      const [limit, offset] = params.map(Number)
      if (sql.includes('FROM accounts')) return (tables.accounts ?? []) as never[]
      if (sql.includes('FROM seasons')) return (tables.seasons ?? []) as never[]
      if (sql.includes('FROM matches')) {
        // Pinned rather than assumed: two games can start in the same
        // millisecond, and without the id as a tie-break a page boundary between
        // them is decided by whatever order the file returns ties in.
        if (!sql.includes('ORDER BY game_creation, match_id')) {
          throw new Error(`matches must be read in a fixed order: ${sql}`)
        }

        const ordered = [...(tables.matches ?? [])].sort(
          (a, b) => a.game_creation - b.game_creation || a.match_id.localeCompare(b.match_id)
        )

        // The ids alone, when that is all that is asked for.
        if (!sql.includes('raw_json')) return ordered.map((m) => ({ match_id: m.match_id })) as never[]

        // Payloads, for the ids asked about.
        if (sql.includes('WHERE match_id IN')) {
          const wanted = new Set(params.map(String))
          return ordered.filter((m) => wanted.has(m.match_id)) as never[]
        }
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

/** A batch answer that took everything, which is what a server with nothing yet answers. */
const took = (rows: unknown[]): ImportBatchOutcome => ({
  accepted: rows.length,
  skipped: 0,
  failed: 0,
  unplaced: 0
})

/**
 * The server's side: records every batch, in order, and answers as a server would.
 *
 * `stored` is the game ids it already holds. `cannotAsk` is a server older than
 * the question, which answers null. `matchAnswer` and `readingAnswer` let a test
 * make it report something other than "took it all".
 */
function recordingTarget(
  options: {
    unresolved?: string[]
    failMatches?: boolean
    stored?: string[]
    cannotAsk?: boolean
    healed?: number
    matchAnswer?: Partial<ImportBatchOutcome>
    readingAnswer?: Partial<ImportBatchOutcome>
    seasonAnswer?: Partial<ImportBatchOutcome>
  } = {}
) {
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
      return rows.map((row, i) => {
        const riotId = `${row.gameName}#${row.tagLine}`
        const resolved = !options.unresolved?.includes(riotId)
        return {
          riotId,
          accountId: resolved ? `id-${row.puuid}` : null,
          resolved,
          message: null,
          healedMatches: i === 0 ? options.healed : undefined
        }
      })
    },
    seasons: async (rows) => {
      calls.push(`seasons:${rows.length}`)
      sent.seasons.push(...rows)
      return { ...took(rows), ...options.seasonAnswer }
    },
    unstoredMatches: async (ids) => {
      calls.push(`unstored:${ids.length}`)
      if (options.cannotAsk) return null
      return ids.filter((id) => !options.stored?.includes(id))
    },
    matches: async (rows) => {
      if (options.failMatches) throw new Error('The server refused a page of matches.')
      calls.push(`matches:${rows.length}`)
      sent.matches.push(...rows)

      // A server that already holds some of what it is sent skips them, which is
      // what the real one does when it cannot be asked first.
      const already = rows.filter((row) => options.stored?.includes(row.matchId)).length
      return { ...took(rows), accepted: rows.length - already, skipped: already, ...options.matchAnswer }
    },
    rankReadings: async (rows) => {
      calls.push(`readings:${rows.length}`)
      sent.readings.push(...rows)
      return { ...took(rows), ...options.readingAnswer }
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

    // The ids go up before any payload does.
    expect(calls).toEqual(['accounts:2', 'seasons:1', 'unstored:1', 'matches:1', 'readings:1', 'finish'])
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

    expect([...new Set(phases)]).toEqual(['accounts', 'comparing', 'matches', 'finishing', 'done'])
  })

  describe('importing a file again', () => {
    const matches = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ match_id: `KR_${i}`, raw_json: `{"i":${i}}`, game_creation: i }))

    it('sends only the games the server does not already have', async () => {
      // A year in the file, and three days of it new: the payloads are 100–200 KB
      // each, so sending all of them again is the difference between a re-upload
      // that takes seconds and one that takes as long as the first.
      const stored = ['KR_0', 'KR_1', 'KR_2', 'KR_3']
      const { target, sent } = recordingTarget({ stored })

      const result = await importStatsDb(fakeDb({ accounts: ACCOUNTS, matches: matches(6) }), target, () => {})

      expect(sent.matches.map((m) => m.matchId)).toEqual(['KR_4', 'KR_5'])
      expect(result).toMatchObject({ ok: true, matches: 2 })
      expect(result.alreadyThere.matches).toBe(4)
    })

    it('asks about ids a page at a time, never all at once', async () => {
      const { target, calls } = recordingTarget()

      await importStatsDb(
        fakeDb({ accounts: ACCOUNTS, matches: matches(IMPORT_ID_PAGE * 2 + 3) }),
        target,
        () => {}
      )

      expect(calls.filter((c) => c.startsWith('unstored:'))).toEqual([
        `unstored:${IMPORT_ID_PAGE}`,
        `unstored:${IMPORT_ID_PAGE}`,
        'unstored:3'
      ])
    })

    it('sends everything to a server too old to be asked, and still reports what it skipped', async () => {
      // Slower, not different: the matches batch skips what it holds, so the
      // answer is the same one arrived at by sending it all.
      const { target, sent } = recordingTarget({ cannotAsk: true, stored: ['KR_0', 'KR_1'] })

      const result = await importStatsDb(fakeDb({ accounts: ACCOUNTS, matches: matches(4) }), target, () => {})

      expect(sent.matches).toHaveLength(4)
      expect(result).toMatchObject({ ok: true, matches: 2 })
      expect(result.alreadyThere.matches).toBe(2)
    })

    it('reads games in a fixed order, so equal timestamps cannot straddle a page unpredictably', async () => {
      // The fake refuses any read that is not ordered by game_creation and then
      // match_id, so this passing at all is the assertion; what it checks here is
      // that ties come out by id.
      const tied = [
        { match_id: 'KR_b', raw_json: '{}', game_creation: 7 },
        { match_id: 'KR_a', raw_json: '{}', game_creation: 7 }
      ]
      const { target, sent } = recordingTarget()

      await importStatsDb(fakeDb({ accounts: ACCOUNTS, matches: tied }), target, () => {})

      expect(sent.matches.map((m) => m.matchId)).toEqual(['KR_a', 'KR_b'])
    })

    it('carries everything the server said about each batch through to the result', async () => {
      // "Nothing happened" has to be several different answers. A game the server
      // could not read, a reading with no account to go to and one it already had
      // are not the same thing, and a person re-sending a file needs to tell them apart.
      const { target } = recordingTarget({
        healed: 4,
        seasonAnswer: { accepted: 0, skipped: 1 },
        matchAnswer: { accepted: 1, skipped: 0, failed: 2 },
        readingAnswer: { accepted: 5, skipped: 3, unplaced: 2 }
      })

      const result = await importStatsDb(
        fakeDb({
          accounts: ACCOUNTS,
          seasons: [{ label: 'S2026', starts_at: 1_000, is_preseason: 0, resets_rank: 1 }],
          matches: matches(3),
          rank_snapshots: [
            { id: 1, account_id: 1, captured_at: 10, queue_type: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', league_points: 40, wins: 1, losses: 0, source: 'lcu', match_id: null }
          ]
        }),
        target,
        () => {}
      )

      expect(result).toMatchObject({
        ok: true,
        matches: 1,
        readings: 5,
        seasons: 0,
        matchesFailed: 2,
        readingsUnplaced: 2,
        healed: 4
      })
      expect(result.alreadyThere).toEqual({ matches: 0, readings: 3, seasons: 1 })
    })

    it('reports the newest game and reading in the file, so a stale copy can be told from an up-to-date server', async () => {
      // A run that added nothing is either finished or was handed a file that
      // stops where the last one did — which is what reading a database without
      // its write-ahead log looks like. Only the file can say which.
      const { target } = recordingTarget({ stored: ['KR_0', 'KR_1', 'KR_2'] })

      const result = await importStatsDb(
        fakeDb({
          accounts: ACCOUNTS,
          matches: matches(3),
          rank_snapshots: [
            { id: 1, account_id: 1, captured_at: 10, queue_type: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', league_points: 40, wins: 1, losses: 0, source: 'lcu', match_id: null },
            { id: 2, account_id: 1, captured_at: 99, queue_type: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', league_points: 52, wins: 2, losses: 0, source: 'lcu', match_id: null }
          ]
        }),
        target,
        () => {}
      )

      expect(result.matches).toBe(0)
      expect(result.newest).toEqual({ matchAt: 2, readingAt: 99 })
    })

    it('says a file with no rank readings has none, rather than inventing a date', async () => {
      const { target } = recordingTarget()

      const result = await importStatsDb(fakeDb({ accounts: ACCOUNTS, matches: [] }), target, () => {})

      expect(result.newest).toEqual({ matchAt: null, readingAt: null })
    })
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
