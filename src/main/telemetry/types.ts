/**
 * Write-side row shapes, one per table in telemetry.db.
 *
 * Every field is already a SQLite-native primitive: node:sqlite binds only
 * null, number, string, bigint and Uint8Array, so booleans are integers and
 * structured values are pre-serialised JSON. Doing that conversion here rather
 * than in the writer keeps the flush loop free of per-row branching.
 */

export type RiotOutcome =
  | 'ok'
  | 'http_error'
  | 'parse_error'
  | 'network_error'
  | 'key_invalid'
  | 'never_ran'

export interface RiotRequestRow {
  requestId: string
  spanId: string | null
  attempt: number
  endpoint: string
  pathHash: string
  host: string
  scheduledAt: number
  startedAt: number
  endedAt: number
  waitMs: number
  networkMs: number
  status: number | null
  outcome: RiotOutcome
  bytes: number | null
  errorKind: string | null
  errorMessage: string | null
  appLimit: string | null
  appLimitCount: string | null
  methodLimit: string | null
  methodLimitCount: string | null
  retryAfterMs: number | null
}

export interface ResourceSampleRow {
  sampledAt: number
  processType: string
  pid: number
  cpuPercent: number | null
  workingSetKb: number | null
  loopDelayMeanMs: number | null
  loopDelayP99Ms: number | null
  loopDelayMaxMs: number | null
  queueDepth: number | null
}

export interface SpanRow {
  spanId: string
  traceId: string
  parentId: string | null
  name: string
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  status: string | null
  errorMessage: string | null
  attrsJson: string | null
}

export interface LcuEventRow {
  occurredAt: number
  kind: 'connected' | 'disconnected' | 'poll' | 'error'
  latencyMs: number | null
  detail: string | null
}

export type PendingEvent =
  | { table: 'riot_requests'; row: RiotRequestRow }
  | { table: 'resource_samples'; row: ResourceSampleRow }
  | { table: 'spans'; row: SpanRow }
  | { table: 'lcu_events'; row: LcuEventRow }
