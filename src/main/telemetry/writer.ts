import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { getMeta, setMeta } from './meta'
import type { PendingEvent } from './types'

/**
 * Buffers telemetry in memory and writes it to SQLite in batches.
 *
 * node:sqlite is `DatabaseSync` — every write blocks the same event loop that
 * runs the Riot rate limiter's pump and every IPC handler. Writing a row per
 * event would put a synchronous disk write inside the request path this system
 * exists to measure, so the latency numbers would include the cost of
 * recording them.
 *
 * Instead events accumulate in memory and land in one transaction on whichever
 * comes first: the flush timer, a root span closing, the buffer reaching its
 * high-water mark, or shutdown. The cost is that a hard crash loses at most a
 * few seconds — which is why span closes force a flush, so the interesting
 * moments commit at natural boundaries rather than on a timer's whim.
 */

/** Flush cadence while idle. Short enough that the panel feels live at 1s polling. */
const FLUSH_INTERVAL_MS = 3_000

/** Flush immediately once this many events are pending, so bursts don't wait. */
const HIGH_WATER = 256

/**
 * Hard ceiling on buffered events. Reached only if flushing is failing or the
 * database is locked; past it the oldest events are dropped so a broken write
 * path degrades into missing data rather than unbounded memory growth.
 */
const MAX_BUFFER = 5_000

const DROPPED_META_KEY = 'writer.dropped'

let buffer: PendingEvent[] = []
let timer: NodeJS.Timeout | null = null
let droppedThisSession = 0
let statements: Statements | null = null
let statementsFor: DatabaseSync | null = null

interface Statements {
  riotRequests: StatementSync
  resourceSamples: StatementSync
  spans: StatementSync
  lcuEvents: StatementSync
}

function prepare(db: DatabaseSync): Statements {
  if (statements && statementsFor === db) return statements
  statements = {
    riotRequests: db.prepare(
      `INSERT INTO riot_requests (
         request_id, span_id, attempt, endpoint, path_hash, host,
         scheduled_at, started_at, ended_at, wait_ms, network_ms,
         status, outcome, bytes, error_kind, error_message,
         app_limit, app_limit_count, method_limit, method_limit_count, retry_after_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    resourceSamples: db.prepare(
      `INSERT INTO resource_samples (
         sampled_at, process_type, pid, cpu_percent, working_set_kb,
         loop_delay_mean_ms, loop_delay_p99_ms, loop_delay_max_ms, queue_depth
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    spans: db.prepare(
      `INSERT INTO spans (
         span_id, trace_id, parent_id, name, started_at, ended_at,
         duration_ms, status, error_message, attrs_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    lcuEvents: db.prepare(
      `INSERT INTO lcu_events (occurred_at, kind, latency_ms, detail) VALUES (?, ?, ?, ?)`
    )
  }
  statementsFor = db
  return statements
}

function writeOne(stmts: Statements, event: PendingEvent): void {
  switch (event.table) {
    case 'riot_requests': {
      const r = event.row
      stmts.riotRequests.run(
        r.requestId, r.spanId, r.attempt, r.endpoint, r.pathHash, r.host,
        r.scheduledAt, r.startedAt, r.endedAt, r.waitMs, r.networkMs,
        r.status, r.outcome, r.bytes, r.errorKind, r.errorMessage,
        r.appLimit, r.appLimitCount, r.methodLimit, r.methodLimitCount, r.retryAfterMs
      )
      return
    }
    case 'resource_samples': {
      const r = event.row
      stmts.resourceSamples.run(
        r.sampledAt, r.processType, r.pid, r.cpuPercent, r.workingSetKb,
        r.loopDelayMeanMs, r.loopDelayP99Ms, r.loopDelayMaxMs, r.queueDepth
      )
      return
    }
    case 'spans': {
      const r = event.row
      stmts.spans.run(
        r.spanId, r.traceId, r.parentId, r.name, r.startedAt, r.endedAt,
        r.durationMs, r.status, r.errorMessage, r.attrsJson
      )
      return
    }
    case 'lcu_events': {
      const r = event.row
      stmts.lcuEvents.run(r.occurredAt, r.kind, r.latencyMs, r.detail)
      return
    }
  }
}

/**
 * Queues an event. Never throws and never touches disk — callers are on
 * measured paths and must not pay for instrumentation beyond an array push.
 */
export function enqueue(event: PendingEvent): void {
  buffer.push(event)

  if (buffer.length > MAX_BUFFER) {
    const overflow = buffer.length - MAX_BUFFER
    buffer.splice(0, overflow)
    droppedThisSession += overflow
  }
}

export function pendingCount(): number {
  return buffer.length
}

export function droppedCount(): number {
  return droppedThisSession
}

/**
 * Writes everything buffered in a single transaction.
 *
 * A failed batch is discarded rather than retried: the most likely cause is a
 * schema or binding bug, and retrying it forever would turn one bad row into a
 * permanently stalled writer. The loss is counted so the panel can show it.
 */
export function flush(db: DatabaseSync): void {
  if (buffer.length === 0) return

  const batch = buffer
  buffer = []

  try {
    const stmts = prepare(db)
    db.exec('BEGIN')
    try {
      for (const event of batch) writeOne(stmts, event)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } catch {
    droppedThisSession += batch.length
    // The statement cache may reference a closed or superseded handle.
    statements = null
    statementsFor = null
    return
  }

  if (droppedThisSession > 0) persistDroppedCount(db)
}

function persistDroppedCount(db: DatabaseSync): void {
  try {
    const previous = Number(getMeta(db, DROPPED_META_KEY) ?? 0)
    setMeta(db, DROPPED_META_KEY, String(previous + droppedThisSession))
    droppedThisSession = 0
  } catch {
    // Bookkeeping only — never let it take down a flush that otherwise worked.
  }
}

export function startWriter(resolveDb: () => DatabaseSync | null): void {
  if (timer) return
  timer = setInterval(() => {
    const db = resolveDb()
    if (db) flush(db)
  }, FLUSH_INTERVAL_MS)
  // Never hold the process open for a telemetry flush.
  timer.unref?.()
}

export function stopWriter(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

/** Called when a burst is likely — a root span closing, or shutdown. */
export function flushIfDue(db: DatabaseSync | null, force = false): void {
  if (!db) return
  if (force || buffer.length >= HIGH_WATER) flush(db)
}

/** Test seam: drops buffered state without writing. */
export function resetWriterForTests(): void {
  buffer = []
  droppedThisSession = 0
  statements = null
  statementsFor = null
  stopWriter()
}
