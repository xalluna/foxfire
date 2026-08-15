import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { applyTelemetryMigrations } from './testMigrations'
import {
  droppedCount,
  enqueue,
  flush,
  flushIfDue,
  pendingCount,
  resetWriterForTests
} from './writer'
import type { RiotRequestRow } from './types'

// Loaded through require rather than a static import: Vite strips the `node:`
// prefix during transform and then fails to resolve the bare `sqlite`
// specifier. Same workaround as matches.repo.test.ts, and the reason writer.ts
// takes its meta helpers from meta.ts rather than db.ts — db.ts imports
// DatabaseSync as a value and so cannot be loaded from a test at all.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

/** Must match MAX_BUFFER in writer.ts. */
const MAX_BUFFER = 5_000
/** Must match HIGH_WATER in writer.ts. */
const HIGH_WATER = 256

function makeDb(): DatabaseSyncType {
  const db = new DatabaseSync(':memory:')
  applyTelemetryMigrations(db)
  return db
}

function requestRow(overrides: Partial<RiotRequestRow> = {}): RiotRequestRow {
  return {
    requestId: 'req-1',
    spanId: null,
    attempt: 1,
    endpoint: '/lol/match/v5/matches/{matchId}',
    pathHash: 'abc123',
    host: 'https://americas.api.riotgames.com',
    scheduledAt: 1_000,
    startedAt: 1_100,
    endedAt: 1_300,
    waitMs: 100,
    networkMs: 200,
    status: 200,
    outcome: 'ok',
    bytes: 4_096,
    errorKind: null,
    errorMessage: null,
    appLimit: '20:1,100:120',
    appLimitCount: '12:1,58:120',
    methodLimit: null,
    methodLimitCount: null,
    retryAfterMs: null,
    ...overrides
  }
}

function countRows(db: DatabaseSyncType): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM riot_requests').get() as unknown as { n: number }
  return row.n
}

afterEach(() => {
  resetWriterForTests()
})

describe('buffering', () => {
  it('holds events in memory until flushed', () => {
    const db = makeDb()
    enqueue({ table: 'riot_requests', row: requestRow() })
    enqueue({ table: 'riot_requests', row: requestRow() })

    expect(pendingCount()).toBe(2)
    expect(countRows(db)).toBe(0)

    flush(db)

    expect(pendingCount()).toBe(0)
    expect(countRows(db)).toBe(2)
  })

  it('writes rows in the order they were enqueued', () => {
    const db = makeDb()
    for (const id of ['a', 'b', 'c']) {
      enqueue({ table: 'riot_requests', row: requestRow({ requestId: id }) })
    }
    flush(db)

    const rows = db
      .prepare('SELECT request_id FROM riot_requests ORDER BY id')
      .all() as unknown as { request_id: string }[]
    expect(rows.map((r) => r.request_id)).toEqual(['a', 'b', 'c'])
  })

  it('does nothing when the buffer is empty', () => {
    const db = makeDb()
    expect(() => flush(db)).not.toThrow()
    expect(countRows(db)).toBe(0)
  })

  it('writes every table it supports', () => {
    const db = makeDb()
    enqueue({ table: 'riot_requests', row: requestRow() })
    enqueue({
      table: 'resource_samples',
      row: {
        sampledAt: 1_000,
        processType: 'Browser',
        pid: 42,
        cpuPercent: 12.5,
        workingSetKb: 150_000,
        loopDelayMeanMs: 1.2,
        loopDelayP99Ms: 8,
        loopDelayMaxMs: 40,
        queueDepth: 3
      }
    })
    enqueue({
      table: 'spans',
      row: {
        spanId: 's1',
        traceId: 't1',
        parentId: null,
        name: 'sync.account',
        startedAt: 1_000,
        endedAt: 2_000,
        durationMs: 1_000,
        status: 'ok',
        errorMessage: null,
        attrsJson: '{"accountId":1}'
      }
    })
    enqueue({
      table: 'lcu_events',
      row: { occurredAt: 1_000, kind: 'connected', latencyMs: null, detail: 'connected' }
    })

    flush(db)

    for (const table of ['riot_requests', 'resource_samples', 'spans', 'lcu_events']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }
      expect(row.n, table).toBe(1)
    }
  })
})

describe('overflow', () => {
  it('drops the oldest events rather than growing without bound', () => {
    for (let i = 0; i < MAX_BUFFER + 10; i += 1) {
      enqueue({ table: 'riot_requests', row: requestRow({ requestId: `r${i}` }) })
    }

    expect(pendingCount()).toBe(MAX_BUFFER)
    expect(droppedCount()).toBe(10)
  })

  it('keeps the newest events when it overflows', () => {
    const db = makeDb()
    for (let i = 0; i < MAX_BUFFER + 5; i += 1) {
      enqueue({ table: 'riot_requests', row: requestRow({ requestId: `r${i}` }) })
    }
    flush(db)

    const first = db
      .prepare('SELECT request_id FROM riot_requests ORDER BY id LIMIT 1')
      .get() as unknown as { request_id: string }
    // The five oldest went; recent history is what a developer panel needs.
    expect(first.request_id).toBe('r5')
  })
})

describe('failure handling', () => {
  it('discards a failed batch instead of retrying it forever', () => {
    const db = makeDb()
    db.exec('DROP TABLE riot_requests')

    enqueue({ table: 'riot_requests', row: requestRow() })
    enqueue({ table: 'riot_requests', row: requestRow() })

    expect(() => flush(db)).not.toThrow()
    // Gone from the buffer, and counted, so the panel can say the view has gaps.
    expect(pendingCount()).toBe(0)
    expect(droppedCount()).toBe(2)
  })

  it('recovers on the next flush once the problem clears', () => {
    const broken = makeDb()
    broken.exec('DROP TABLE riot_requests')
    enqueue({ table: 'riot_requests', row: requestRow() })
    flush(broken)

    const healthy = makeDb()
    enqueue({ table: 'riot_requests', row: requestRow({ requestId: 'after' }) })
    flush(healthy)

    expect(countRows(healthy)).toBe(1)
  })
})

describe('flushIfDue', () => {
  it('waits below the high-water mark', () => {
    const db = makeDb()
    enqueue({ table: 'riot_requests', row: requestRow() })
    flushIfDue(db)
    expect(countRows(db)).toBe(0)
  })

  it('flushes once the high-water mark is reached', () => {
    const db = makeDb()
    for (let i = 0; i < HIGH_WATER; i += 1) {
      enqueue({ table: 'riot_requests', row: requestRow() })
    }
    flushIfDue(db)
    expect(countRows(db)).toBe(HIGH_WATER)
  })

  it('flushes immediately when forced, which is what a closing root span does', () => {
    const db = makeDb()
    enqueue({ table: 'riot_requests', row: requestRow() })
    flushIfDue(db, true)
    expect(countRows(db)).toBe(1)
  })

  it('is a no-op with no database, so events survive until one exists', () => {
    enqueue({ table: 'riot_requests', row: requestRow() })
    expect(() => flushIfDue(null, true)).not.toThrow()
    expect(pendingCount()).toBe(1)
  })
})
