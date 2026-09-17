import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTelemetryMigrations } from './testMigrations'
import { databaseBytes, runRetention } from './retention'
import { getMeta } from './meta'

// See the note in matches.repo.test.ts — Vite strips the `node:` prefix and
// then cannot resolve a bare `sqlite`.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const RAW_RETENTION_MS = 48 * HOUR

let db: DatabaseSyncType
let now: number

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applyTelemetryMigrations(db)
  now = Date.now()
})

function insertRequest(startedAt: number, overrides: Partial<Record<string, unknown>> = {}): void {
  const values = {
    request_id: `r${startedAt}`,
    endpoint: '/lol/match/v5/matches/{matchId}',
    wait_ms: 100,
    network_ms: 200,
    status: 200,
    outcome: 'ok',
    bytes: 1_000,
    ...overrides
  }

  db.prepare(
    `INSERT INTO riot_requests (
       request_id, attempt, endpoint, path_hash, host, scheduled_at, started_at, ended_at,
       wait_ms, network_ms, status, outcome, bytes
     ) VALUES (?, 1, ?, 'hash', 'host', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    values.request_id as string,
    values.endpoint as string,
    startedAt,
    startedAt,
    startedAt,
    values.wait_ms as number,
    values.network_ms as number,
    values.status as number | null,
    values.outcome as string,
    values.bytes as number
  )
}

function insertSample(sampledAt: number, cpu: number): void {
  db.prepare(
    `INSERT INTO resource_samples (sampled_at, process_type, pid, cpu_percent, working_set_kb)
     VALUES (?, 'Browser', 1, ?, 150000)`
  ).run(sampledAt, cpu)
}

function count(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }
  return row.n
}

describe('rollup', () => {
  it('folds raw requests into per-minute per-endpoint buckets', () => {
    const bucket = Math.floor((now - 10 * MINUTE) / MINUTE) * MINUTE
    for (let i = 0; i < 5; i += 1) insertRequest(bucket + i * 1_000)
    insertRequest(bucket + 6_000, { endpoint: '/lol/league/v4/entries/by-puuid/{puuid}' })

    runRetention(db)

    const rows = db
      .prepare('SELECT endpoint, requests, bytes FROM riot_request_rollup_1m ORDER BY endpoint')
      .all() as unknown as { endpoint: string; requests: number; bytes: number }[]

    expect(rows).toHaveLength(2)
    expect(rows[1].requests).toBe(5)
    expect(rows[1].bytes).toBe(5_000)
  })

  it('records percentiles and extremes for the bucket', () => {
    const bucket = Math.floor((now - 10 * MINUTE) / MINUTE) * MINUTE
    for (const wait of [10, 20, 30, 40, 100]) {
      insertRequest(bucket + wait, { wait_ms: wait, network_ms: wait * 2 })
    }

    runRetention(db)

    const row = db
      .prepare('SELECT wait_min, wait_p50, wait_p95, wait_max, net_max FROM riot_request_rollup_1m')
      .get() as unknown as Record<string, number>

    expect(row.wait_min).toBe(10)
    expect(row.wait_p50).toBe(30)
    expect(row.wait_p95).toBe(100)
    expect(row.wait_max).toBe(100)
    expect(row.net_max).toBe(200)
  })

  it('classifies failures by status class', () => {
    const bucket = Math.floor((now - 10 * MINUTE) / MINUTE) * MINUTE
    insertRequest(bucket + 1, { status: 429, outcome: 'http_error' })
    insertRequest(bucket + 2, { status: 503, outcome: 'http_error' })
    // No HTTP status to classify by — these land together.
    insertRequest(bucket + 3, { status: null, outcome: 'network_error' })
    insertRequest(bucket + 4, { status: 200, outcome: 'parse_error' })

    runRetention(db)

    const row = db
      .prepare('SELECT errors_4xx, errors_5xx, errors_other FROM riot_request_rollup_1m')
      .get() as unknown as Record<string, number>

    expect(row.errors_4xx).toBe(1)
    expect(row.errors_5xx).toBe(1)
    expect(row.errors_other).toBe(2)
  })

  it('leaves the current minute alone, since it is still being written', () => {
    insertRequest(now)
    runRetention(db)
    expect(count('riot_request_rollup_1m')).toBe(0)
  })

  it('advances a watermark so the next pass does not rescan', () => {
    insertRequest(now - 10 * MINUTE)
    runRetention(db)

    const watermark = Number(getMeta(db, 'retention.rolledThrough'))
    expect(watermark).toBeGreaterThan(0)
    expect(watermark).toBeLessThanOrEqual(now)
  })

  it('rolls up resource samples too', () => {
    const bucket = Math.floor((now - 10 * MINUTE) / MINUTE) * MINUTE
    insertSample(bucket + 1_000, 10)
    insertSample(bucket + 2_000, 30)

    runRetention(db)

    const row = db
      .prepare('SELECT samples, cpu_avg, cpu_max FROM resource_rollup_1m')
      .get() as unknown as { samples: number; cpu_avg: number; cpu_max: number }

    expect(row.samples).toBe(2)
    expect(row.cpu_avg).toBe(20)
    expect(row.cpu_max).toBe(30)
  })
})

describe('pruning', () => {
  it('drops raw rows older than the retention window and keeps newer ones', () => {
    insertRequest(now - RAW_RETENTION_MS - MINUTE)
    insertRequest(now - RAW_RETENTION_MS + HOUR)

    runRetention(db)

    expect(count('riot_requests')).toBe(1)
  })

  it('keeps a row sitting just inside the boundary', () => {
    insertRequest(now - RAW_RETENTION_MS + MINUTE)
    runRetention(db)
    expect(count('riot_requests')).toBe(1)
  })

  it('prunes every raw table, not just requests', () => {
    const old = now - RAW_RETENTION_MS - HOUR
    insertSample(old, 10)
    db.prepare(
      `INSERT INTO spans (span_id, trace_id, name, started_at) VALUES ('s', 't', 'sync', ?)`
    ).run(old)
    db.prepare(`INSERT INTO lcu_events (occurred_at, kind) VALUES (?, 'poll')`).run(old)

    runRetention(db)

    expect(count('resource_samples')).toBe(0)
    expect(count('spans')).toBe(0)
    expect(count('lcu_events')).toBe(0)
  })

  it('drops rollup buckets older than thirty days', () => {
    db.prepare(
      `INSERT INTO riot_request_rollup_1m (bucket_at, endpoint, requests) VALUES (?, 'x', 1)`
    ).run(now - 31 * 24 * HOUR)
    db.prepare(
      `INSERT INTO riot_request_rollup_1m (bucket_at, endpoint, requests) VALUES (?, 'y', 1)`
    ).run(now - 29 * 24 * HOUR)

    runRetention(db)

    expect(count('riot_request_rollup_1m')).toBe(1)
  })

  it('rolls a bucket up before pruning the rows behind it', () => {
    // Sits inside the raw window, so it must survive into a bucket.
    const bucket = Math.floor((now - HOUR) / MINUTE) * MINUTE
    insertRequest(bucket)

    runRetention(db)

    expect(count('riot_request_rollup_1m')).toBe(1)
    expect(count('riot_requests')).toBe(1)
  })
})

describe('size ceiling', () => {
  it('evicts older raw rows when the database exceeds the ceiling', () => {
    // Inside the 48h window, so time-based pruning alone would keep all of it.
    for (let i = 0; i < 400; i += 1) insertRequest(now - 40 * HOUR + i * 1_000)
    const before = count('riot_requests')

    // A ceiling below the current size forces the backstop to act.
    runRetention(db, 1_024)

    expect(count('riot_requests')).toBeLessThan(before)
  })

  it('leaves everything alone when the database is under the ceiling', () => {
    for (let i = 0; i < 10; i += 1) insertRequest(now - HOUR + i * 1_000)

    runRetention(db, 500 * 1024 * 1024)

    expect(count('riot_requests')).toBe(10)
  })

  it('stops rather than spinning when nothing is old enough to evict', () => {
    insertRequest(now - MINUTE)
    // Ceiling of zero can never be satisfied; the loop must still terminate.
    expect(() => runRetention(db, 0)).not.toThrow()
  })
})

describe('databaseBytes', () => {
  it('reports a non-zero size for a populated database', () => {
    insertRequest(now - HOUR)
    expect(databaseBytes(db)).toBeGreaterThan(0)
  })
})
