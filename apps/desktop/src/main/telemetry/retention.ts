import type { DatabaseSync } from 'node:sqlite'
import { getMeta, setMeta } from './meta'
import { maxOf, minOf, percentile } from './stats'

/**
 * Keeps telemetry.db from growing without bound.
 *
 * Raw rows survive 48 hours — long enough to answer "what happened last night"
 * in full detail — after being folded into per-minute buckets that survive 30
 * days for trend graphs. A hard size ceiling sits underneath both as a
 * backstop, so no combination of heavy days can produce a surprise on disk.
 *
 * IMPORTANT about the rolled-up percentiles: a p95 stored per minute cannot be
 * re-aggregated exactly across minutes. Averaging or maxing them gives an
 * approximation, not the true p95 of the wider range. That imprecision is
 * accepted here — the alternative is storing t-digests per bucket, which is a
 * lot of machinery for a developer tool. Read a rolled-up percentile as "the
 * shape of that minute".
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const RAW_RETENTION_MS = 48 * HOUR_MS
const ROLLUP_RETENTION_MS = 30 * 24 * HOUR_MS
const SIZE_CEILING_BYTES = 250 * 1024 * 1024

/** Between passes. Retention is not urgent; it just must not never run. */
const RETENTION_INTERVAL_MS = 30 * 60_000

/** Long enough to be clear of startup. */
const FIRST_PASS_DELAY_MS = 30_000

/**
 * Rows deleted per statement. Deletes are synchronous and block the main
 * thread, so a single unbounded DELETE after a long heavy session could stall
 * the app for a visible moment. Batching trades a few extra statements for
 * never holding the loop long.
 */
const DELETE_BATCH = 5_000

const ROLLUP_WATERMARK_KEY = 'retention.rolledThrough'

let timer: NodeJS.Timeout | null = null

interface RequestBucketRow {
  bucket: number
  endpoint: string
  wait_ms: number
  network_ms: number
  status: number | null
  outcome: string
  bytes: number | null
}

function rollUpRequests(db: DatabaseSync, from: number, to: number): void {
  const rows = db
    .prepare(
      `SELECT (started_at / ${MINUTE_MS}) * ${MINUTE_MS} AS bucket,
              endpoint, wait_ms, network_ms, status, outcome, bytes
         FROM riot_requests
        WHERE started_at >= ? AND started_at < ?`
    )
    .all(from, to) as unknown as RequestBucketRow[]

  if (rows.length === 0) return

  interface Bucket {
    waits: number[]
    nets: number[]
    requests: number
    errors4xx: number
    errors5xx: number
    errorsOther: number
    bytes: number
  }

  const buckets = new Map<string, { at: number; endpoint: string; data: Bucket }>()

  for (const row of rows) {
    const key = `${row.bucket}|${row.endpoint}`
    let entry = buckets.get(key)
    if (!entry) {
      entry = {
        at: row.bucket,
        endpoint: row.endpoint,
        data: {
          waits: [],
          nets: [],
          requests: 0,
          errors4xx: 0,
          errors5xx: 0,
          errorsOther: 0,
          bytes: 0
        }
      }
      buckets.set(key, entry)
    }

    const data = entry.data
    data.requests += 1
    data.waits.push(row.wait_ms)
    data.nets.push(row.network_ms)
    data.bytes += row.bytes ?? 0

    if (row.outcome !== 'ok') {
      if (row.status !== null && row.status >= 400 && row.status < 500) data.errors4xx += 1
      else if (row.status !== null && row.status >= 500) data.errors5xx += 1
      // parse_error, network_error, key_invalid and never_ran have no status to
      // classify by, so they land together.
      else data.errorsOther += 1
    }
  }

  const insert = db.prepare(
    `INSERT INTO riot_request_rollup_1m (
       bucket_at, endpoint, requests, errors_4xx, errors_5xx, errors_other,
       wait_min, wait_p50, wait_p95, wait_max, net_min, net_p50, net_p95, net_max, bytes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(bucket_at, endpoint) DO UPDATE SET
       requests = excluded.requests,
       errors_4xx = excluded.errors_4xx,
       errors_5xx = excluded.errors_5xx,
       errors_other = excluded.errors_other,
       wait_min = excluded.wait_min, wait_p50 = excluded.wait_p50,
       wait_p95 = excluded.wait_p95, wait_max = excluded.wait_max,
       net_min = excluded.net_min, net_p50 = excluded.net_p50,
       net_p95 = excluded.net_p95, net_max = excluded.net_max,
       bytes = excluded.bytes`
  )

  for (const { at, endpoint, data } of buckets.values()) {
    insert.run(
      at,
      endpoint,
      data.requests,
      data.errors4xx,
      data.errors5xx,
      data.errorsOther,
      minOf(data.waits),
      percentile(data.waits, 50),
      percentile(data.waits, 95),
      maxOf(data.waits),
      minOf(data.nets),
      percentile(data.nets, 50),
      percentile(data.nets, 95),
      maxOf(data.nets),
      data.bytes
    )
  }
}

function rollUpResources(db: DatabaseSync, from: number, to: number): void {
  db.prepare(
    `INSERT INTO resource_rollup_1m (
       bucket_at, process_type, samples, cpu_avg, cpu_max, mem_avg_kb, mem_max_kb,
       loop_delay_max_ms, queue_depth_max
     )
     SELECT (sampled_at / ${MINUTE_MS}) * ${MINUTE_MS} AS bucket,
            process_type,
            COUNT(*),
            AVG(cpu_percent),
            MAX(cpu_percent),
            CAST(AVG(working_set_kb) AS INTEGER),
            MAX(working_set_kb),
            MAX(loop_delay_max_ms),
            MAX(queue_depth)
       FROM resource_samples
      WHERE sampled_at >= ? AND sampled_at < ?
      GROUP BY bucket, process_type
     ON CONFLICT(bucket_at, process_type) DO UPDATE SET
       samples = excluded.samples,
       cpu_avg = excluded.cpu_avg, cpu_max = excluded.cpu_max,
       mem_avg_kb = excluded.mem_avg_kb, mem_max_kb = excluded.mem_max_kb,
       loop_delay_max_ms = excluded.loop_delay_max_ms,
       queue_depth_max = excluded.queue_depth_max`
  ).run(from, to)
}

/** Deletes in bounded batches, returning how many rows went. */
function deleteBefore(db: DatabaseSync, table: string, column: string, cutoff: number): number {
  let removed = 0
  for (;;) {
    const result = db
      .prepare(
        `DELETE FROM ${table} WHERE rowid IN (
           SELECT rowid FROM ${table} WHERE ${column} < ? LIMIT ${DELETE_BATCH}
         )`
      )
      .run(cutoff)
    const changes = Number(result.changes ?? 0)
    removed += changes
    if (changes < DELETE_BATCH) return removed
  }
}

/**
 * Bytes actually in use, from SQLite's own page accounting rather than statSync.
 *
 * Subtracting the freelist is what makes this usable as a loop condition: a
 * plain page_count does not shrink when rows are deleted — the pages are freed,
 * not released to the filesystem, until a VACUUM — so an eviction loop reading
 * it would never observe its own progress and would delete far more than
 * necessary. It also keeps this module free of the file path, and so of
 * Electron.
 */
export function databaseBytes(db: DatabaseSync): number {
  const pages = Number(readPragma(db, 'page_count'))
  const free = Number(readPragma(db, 'freelist_count'))
  const size = Number(readPragma(db, 'page_size'))
  return Math.max(0, pages - free) * size
}

function readPragma(db: DatabaseSync, name: string): number {
  const row = db.prepare(`PRAGMA ${name}`).get() as unknown as Record<string, number> | undefined
  return row ? (Object.values(row)[0] ?? 0) : 0
}

/** How far the eviction loop steps its cutoff forwards each pass. */
const EVICTION_STEP_MS = 6 * HOUR_MS

/**
 * Backstop for when the time-based schedule is not enough.
 *
 * Walks the raw cutoff forwards in six-hour steps until the database fits, so
 * an unusually heavy period loses its oldest detail rather than the file
 * quietly growing past the ceiling.
 *
 * An empty step is not a reason to stop: data is rarely spread evenly, and a
 * quiet six hours at the start of the window would otherwise abandon the whole
 * eviction with the ceiling still exceeded. The loop ends when the database
 * fits or when the cutoff reaches the present, whichever comes first.
 */
function enforceSizeCeiling(db: DatabaseSync, ceiling: number): boolean {
  if (databaseBytes(db) <= ceiling) return false

  let evicted = false
  let cutoff = Date.now() - RAW_RETENTION_MS

  while (databaseBytes(db) > ceiling) {
    cutoff += EVICTION_STEP_MS
    if (cutoff > Date.now()) break

    const removed =
      deleteBefore(db, 'riot_requests', 'started_at', cutoff) +
      deleteBefore(db, 'resource_samples', 'sampled_at', cutoff) +
      deleteBefore(db, 'spans', 'started_at', cutoff) +
      deleteBefore(db, 'lcu_events', 'occurred_at', cutoff)
    if (removed > 0) evicted = true
  }

  return evicted
}

export function runRetention(db: DatabaseSync, sizeCeiling = SIZE_CEILING_BYTES): void {
  const now = Date.now()
  // Never roll up the current minute — it is still being written to, and a
  // bucket committed early would be wrong and then overwritten anyway.
  const rollUpTo = Math.floor(now / MINUTE_MS) * MINUTE_MS
  const watermark = Number(getMeta(db, ROLLUP_WATERMARK_KEY) ?? 0)
  // Anything older than the raw window is already gone, so there is nothing to
  // roll up from it — this also stops a first run on an old file scanning
  // everything.
  const rollUpFrom = Math.max(watermark, now - RAW_RETENTION_MS)

  db.exec('BEGIN')
  try {
    if (rollUpTo > rollUpFrom) {
      rollUpRequests(db, rollUpFrom, rollUpTo)
      rollUpResources(db, rollUpFrom, rollUpTo)
      setMeta(db, ROLLUP_WATERMARK_KEY, String(rollUpTo))
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  const rawCutoff = now - RAW_RETENTION_MS
  deleteBefore(db, 'riot_requests', 'started_at', rawCutoff)
  deleteBefore(db, 'resource_samples', 'sampled_at', rawCutoff)
  deleteBefore(db, 'spans', 'started_at', rawCutoff)
  deleteBefore(db, 'lcu_events', 'occurred_at', rawCutoff)

  const rollupCutoff = now - ROLLUP_RETENTION_MS
  deleteBefore(db, 'riot_request_rollup_1m', 'bucket_at', rollupCutoff)
  deleteBefore(db, 'resource_rollup_1m', 'bucket_at', rollupCutoff)

  // VACUUM only after an eviction: it rewrites the whole file and blocks while
  // it does, so it must not run on every pass.
  if (enforceSizeCeiling(db, sizeCeiling)) db.exec('VACUUM')
}

/**
 * Self-gating, like the resource sampler: with telemetry off there is no open
 * database and each pass returns immediately, which is cheaper than starting
 * and stopping a timer as the setting is toggled.
 *
 * Takes a resolver rather than importing the connection, matching startWriter —
 * it keeps this module free of db.ts and therefore testable.
 */
export function startRetention(resolveDb: () => DatabaseSync | null): void {
  if (timer) return
  const pass = (): void => {
    const db = resolveDb()
    if (db) {
      try {
        runRetention(db)
      } catch {
        // Retention failing must never take the app down; the next pass retries
        // and the size ceiling is a backstop for the backstop.
      }
    }
  }

  // Deferred rather than run immediately: the first pass can delete and vacuum,
  // and doing that during startup would compete with creating the window.
  const first = setTimeout(() => {
    pass()
    timer = setInterval(pass, RETENTION_INTERVAL_MS)
    timer.unref?.()
  }, FIRST_PASS_DELAY_MS)
  first.unref?.()
  timer = first
}

export function stopRetention(): void {
  if (timer) {
    // Covers both handles: the deferred first pass is a timeout, everything
    // after it is an interval, and both are held in the same slot.
    clearTimeout(timer)
    clearInterval(timer)
  }
  timer = null
}
