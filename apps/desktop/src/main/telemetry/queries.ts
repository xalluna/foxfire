import type { DatabaseSync } from 'node:sqlite'
import { telemetryDbForRead } from './index'
import { percentile } from './stats'
import type {
  LcuTelemetry,
  RateLimitSeries,
  RateLimitWindowSeries,
  ResourceData,
  ResourceSeries,
  TelemetryEndpointStat,
  TelemetryOutcome,
  TelemetryRequest,
  TelemetryRequestQuery,
  TelemetrySummary
} from '@shared/telemetry'

/**
 * Read side of the panel.
 *
 * Deliberately not gated on whether collection is enabled: switching telemetry
 * off should stop new rows appearing, not blank out the history already
 * gathered.
 */

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1_000

/**
 * Ceiling on rows pulled for aggregation.
 *
 * Percentiles are computed in JS rather than SQL because SQLite has no
 * percentile function and the OFFSET trick costs a query per statistic. At a
 * sustained 20 req/s the cap is reached after ~15 minutes of solid backfill, at
 * which point the summary describes the most recent 20k attempts rather than
 * the whole window. That's an acceptable answer for a developer tool, and the
 * request table beneath it is unaffected.
 */
const AGGREGATE_SCAN_CAP = 20_000

interface RequestRow {
  id: number
  request_id: string
  span_id: string | null
  attempt: number
  endpoint: string
  path_hash: string
  host: string
  scheduled_at: number
  started_at: number
  wait_ms: number
  network_ms: number
  status: number | null
  outcome: string
  bytes: number | null
  error_kind: string | null
  error_message: string | null
  app_limit: string | null
  app_limit_count: string | null
  method_limit: string | null
  method_limit_count: string | null
  retry_after_ms: number | null
}

function toRequest(row: RequestRow): TelemetryRequest {
  return {
    id: row.id,
    requestId: row.request_id,
    spanId: row.span_id,
    attempt: row.attempt,
    endpoint: row.endpoint,
    pathHash: row.path_hash,
    host: row.host,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    waitMs: row.wait_ms,
    networkMs: row.network_ms,
    status: row.status,
    outcome: row.outcome as TelemetryOutcome,
    bytes: row.bytes,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
    appLimit: row.app_limit,
    appLimitCount: row.app_limit_count,
    methodLimit: row.method_limit,
    methodLimitCount: row.method_limit_count,
    retryAfterMs: row.retry_after_ms
  }
}

export function listRequests(query: TelemetryRequestQuery): TelemetryRequest[] {
  const db = telemetryDbForRead()
  const since = Date.now() - query.windowMs
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

  const clauses = ['started_at >= ?']
  const params: (string | number)[] = [since]

  if (query.endpoint) {
    clauses.push('endpoint = ?')
    params.push(query.endpoint)
  }
  if (query.outcome) {
    clauses.push('outcome = ?')
    params.push(query.outcome)
  }
  if (query.beforeId) {
    clauses.push('id < ?')
    params.push(query.beforeId)
  }
  params.push(limit)

  const rows = db
    .prepare(
      `SELECT id, request_id, span_id, attempt, endpoint, path_hash, host,
              scheduled_at, started_at, wait_ms, network_ms, status, outcome, bytes,
              error_kind, error_message, app_limit, app_limit_count,
              method_limit, method_limit_count, retry_after_ms
         FROM riot_requests
        WHERE ${clauses.join(' AND ')}
        ORDER BY id DESC
        LIMIT ?`
    )
    .all(...params) as unknown as RequestRow[]

  return rows.map(toRequest)
}

/** The distinct endpoint templates seen in the window, for the filter dropdown. */
export function listEndpoints(windowMs: number): string[] {
  const db = telemetryDbForRead()
  const rows = db
    .prepare(
      `SELECT DISTINCT endpoint FROM riot_requests WHERE started_at >= ? ORDER BY endpoint`
    )
    .all(Date.now() - windowMs) as unknown as { endpoint: string }[]
  return rows.map((row) => row.endpoint)
}

interface AggregateRow {
  request_id: string
  endpoint: string
  wait_ms: number
  network_ms: number
  status: number | null
  outcome: string
  bytes: number | null
}

export function summarise(windowMs: number): TelemetrySummary {
  const db = telemetryDbForRead()
  const since = Date.now() - windowMs

  const rows = db
    .prepare(
      `SELECT request_id, endpoint, wait_ms, network_ms, status, outcome, bytes
         FROM riot_requests
        WHERE started_at >= ?
        ORDER BY id DESC
        LIMIT ?`
    )
    .all(since, AGGREGATE_SCAN_CAP) as unknown as AggregateRow[]

  const logical = new Set<string>()
  const waits: number[] = []
  const nets: number[] = []
  const perEndpoint = new Map<string, { waits: number[]; nets: number[]; errors: number; bytes: number }>()

  let errors = 0
  let throttled = 0
  let bytes = 0

  for (const row of rows) {
    logical.add(row.request_id)
    waits.push(row.wait_ms)
    nets.push(row.network_ms)
    bytes += row.bytes ?? 0

    const failed = row.outcome !== 'ok'
    if (failed) errors += 1
    if (row.status === 429) throttled += 1

    let bucket = perEndpoint.get(row.endpoint)
    if (!bucket) {
      bucket = { waits: [], nets: [], errors: 0, bytes: 0 }
      perEndpoint.set(row.endpoint, bucket)
    }
    bucket.waits.push(row.wait_ms)
    bucket.nets.push(row.network_ms)
    bucket.bytes += row.bytes ?? 0
    if (failed) bucket.errors += 1
  }

  const byEndpoint: TelemetryEndpointStat[] = [...perEndpoint.entries()]
    .map(([endpoint, bucket]) => ({
      endpoint,
      requests: bucket.waits.length,
      errors: bucket.errors,
      waitP95: percentile(bucket.waits, 95),
      netP50: percentile(bucket.nets, 50),
      netP95: percentile(bucket.nets, 95),
      bytes: bucket.bytes
    }))
    .sort((a, b) => b.requests - a.requests)

  return {
    windowMs,
    attempts: rows.length,
    logicalRequests: logical.size,
    errors,
    throttled,
    bytes,
    waitP50: percentile(waits, 50),
    waitP95: percentile(waits, 95),
    netP50: percentile(nets, 50),
    netP95: percentile(nets, 95),
    byEndpoint
  }
}

/**
 * Riot advertises limits as `limit:windowSeconds` pairs, e.g. `20:1,100:120`,
 * and reports current usage the same way in the -Count headers. Returns a map
 * of window seconds to value.
 */
function parseLimitHeader(header: string | null): Map<number, number> {
  const out = new Map<number, number>()
  if (!header) return out
  for (const pair of header.split(',')) {
    const [value, windowSeconds] = pair.split(':').map(Number)
    if (Number.isFinite(value) && Number.isFinite(windowSeconds)) out.set(windowSeconds, value)
  }
  return out
}

interface LimitRow {
  started_at: number
  status: number | null
  app_limit: string | null
  app_limit_count: string | null
  method_limit: string | null
  method_limit_count: string | null
}

/**
 * Headroom against Riot's own counters.
 *
 * This is the only place in the app that reads X-App-Rate-Limit-Count. The
 * limiter works from hardcoded numbers and never looks at these headers, so the
 * gap between what it believes it sent and what Riot counted is exactly what
 * this chart is for — and nothing here feeds back into the limiter.
 */
export function rateLimitSeries(windowMs: number): RateLimitSeries {
  const db = telemetryDbForRead()
  const since = Date.now() - windowMs

  const rows = db
    .prepare(
      `SELECT started_at, status, app_limit, app_limit_count, method_limit, method_limit_count
         FROM riot_requests
        WHERE started_at >= ? AND app_limit_count IS NOT NULL
        ORDER BY id DESC
        LIMIT ?`
    )
    .all(since, AGGREGATE_SCAN_CAP) as unknown as LimitRow[]

  const throttled = db
    .prepare(
      `SELECT started_at FROM riot_requests
        WHERE started_at >= ? AND status = 429
        ORDER BY started_at`
    )
    .all(since) as unknown as { started_at: number }[]

  // Peak per bucket rather than average: headroom is about how close the worst
  // moment came to the ceiling, and an average would hide exactly that.
  const bucketMs = bucketSizeFor(windowMs)
  const app = new Map<number, { limit: number; peaks: Map<number, number> }>()
  const method = new Map<number, { limit: number; peaks: Map<number, number> }>()

  for (const row of rows) {
    collectLimits(app, row, bucketMs, row.app_limit, row.app_limit_count)
    collectLimits(method, row, bucketMs, row.method_limit, row.method_limit_count)
  }

  return {
    app: toWindowSeries(app),
    method: toWindowSeries(method),
    throttledAt: throttled.map((r) => r.started_at)
  }
}

function collectLimits(
  target: Map<number, { limit: number; peaks: Map<number, number> }>,
  row: LimitRow,
  bucketMs: number,
  limitHeader: string | null,
  countHeader: string | null
): void {
  const limits = parseLimitHeader(limitHeader)
  const counts = parseLimitHeader(countHeader)
  const bucket = Math.floor(row.started_at / bucketMs) * bucketMs

  for (const [windowSeconds, count] of counts) {
    let entry = target.get(windowSeconds)
    if (!entry) {
      entry = { limit: limits.get(windowSeconds) ?? 0, peaks: new Map() }
      target.set(windowSeconds, entry)
    }
    if (entry.limit === 0) entry.limit = limits.get(windowSeconds) ?? 0
    entry.peaks.set(bucket, Math.max(entry.peaks.get(bucket) ?? 0, count))
  }
}

function toWindowSeries(
  source: Map<number, { limit: number; peaks: Map<number, number> }>
): RateLimitWindowSeries[] {
  return [...source.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([windowSeconds, entry]) => ({
      windowSeconds,
      limit: entry.limit,
      points: [...entry.peaks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([at, count]) => ({ at, count }))
    }))
}

/** Keeps every series under a few hundred points regardless of the window. */
function bucketSizeFor(windowMs: number): number {
  return Math.max(1_000, Math.round(windowMs / 300))
}

interface ResourceBucketRow {
  process_type: string
  bucket: number
  cpu: number | null
  mem: number | null
}

export function resourceSeries(windowMs: number): ResourceData {
  const db = telemetryDbForRead()
  const since = Date.now() - windowMs
  const bucketMs = bucketSizeFor(windowMs)

  const rows = db
    .prepare(
      `SELECT process_type,
              (sampled_at / ?) * ? AS bucket,
              AVG(cpu_percent) AS cpu,
              MAX(working_set_kb) AS mem
         FROM resource_samples
        WHERE sampled_at >= ?
        GROUP BY process_type, bucket
        ORDER BY bucket`
    )
    .all(bucketMs, bucketMs, since) as unknown as ResourceBucketRow[]

  const grouped = new Map<string, ResourceSeries>()
  for (const row of rows) {
    let series = grouped.get(row.process_type)
    if (!series) {
      series = { processType: row.process_type, points: [] }
      grouped.set(row.process_type, series)
    }
    series.points.push({
      at: row.bucket,
      cpuPercent: row.cpu === null ? null : Number(row.cpu.toFixed(2)),
      workingSetKb: row.mem
    })
  }

  const loopRows = db
    .prepare(
      `SELECT (sampled_at / ?) * ? AS bucket,
              AVG(loop_delay_mean_ms) AS mean,
              MAX(loop_delay_p99_ms) AS p99,
              MAX(loop_delay_max_ms) AS max,
              MAX(queue_depth) AS depth
         FROM resource_samples
        WHERE sampled_at >= ? AND loop_delay_mean_ms IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket`
    )
    .all(bucketMs, bucketMs, since) as unknown as {
    bucket: number
    mean: number | null
    p99: number | null
    max: number | null
    depth: number | null
  }[]

  return {
    series: [...grouped.values()].sort((a, b) => a.processType.localeCompare(b.processType)),
    loopDelay: loopRows.map((row) => ({
      at: row.bucket,
      meanMs: row.mean === null ? null : Number(row.mean.toFixed(2)),
      p99Ms: row.p99,
      maxMs: row.max,
      queueDepth: row.depth
    }))
  }
}

export function lcuTelemetry(windowMs: number): LcuTelemetry {
  const db = telemetryDbForRead()
  const since = Date.now() - windowMs

  const latency = db
    .prepare(
      `SELECT occurred_at, latency_ms FROM lcu_events
        WHERE occurred_at >= ? AND kind = 'poll' AND latency_ms IS NOT NULL
        ORDER BY occurred_at`
    )
    .all(since) as unknown as { occurred_at: number; latency_ms: number }[]

  const recent = db
    .prepare(
      `SELECT occurred_at, kind, latency_ms, detail FROM lcu_events
        WHERE occurred_at >= ? AND kind != 'poll'
        ORDER BY occurred_at DESC
        LIMIT 50`
    )
    .all(since) as unknown as {
    occurred_at: number
    kind: string
    latency_ms: number | null
    detail: string | null
  }[]

  return {
    latency: latency.map((row) => ({ at: row.occurred_at, ms: row.latency_ms })),
    recent: recent.map((row) => ({
      at: row.occurred_at,
      kind: row.kind,
      latencyMs: row.latency_ms,
      detail: row.detail
    }))
  }
}

/** Drops every row while leaving the file and its schema in place. */
export function clearTelemetry(db: DatabaseSync = telemetryDbForRead()): void {
  db.exec('BEGIN')
  try {
    for (const table of [
      'riot_requests',
      'riot_request_rollup_1m',
      'resource_samples',
      'resource_rollup_1m',
      'spans',
      'lcu_events'
    ]) {
      db.exec(`DELETE FROM ${table}`)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  db.exec('VACUUM')
}
