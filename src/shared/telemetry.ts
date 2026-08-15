/**
 * Types crossing the IPC bridge for the developer telemetry panel.
 *
 * Kept out of types.ts because none of it describes the product — it describes
 * the app watching itself, and nothing in the main UI ever imports it.
 */

export type TelemetryOutcome =
  | 'ok'
  | 'http_error'
  | 'parse_error'
  | 'network_error'
  | 'key_invalid'
  | 'never_ran'

export interface TelemetryState {
  enabled: boolean
  dbPath: string
  /** Buffered in memory, not yet committed. */
  pending: number
  /** Lost to buffer overflow or a failed batch. A non-zero value means gaps. */
  dropped: number
  /** Size on disk, or null before the file has ever been created. */
  dbBytes: number | null
}

/** One attempt. Retries of the same logical request share `requestId`. */
export interface TelemetryRequest {
  id: number
  requestId: string
  spanId: string | null
  attempt: number
  endpoint: string
  pathHash: string
  host: string
  scheduledAt: number
  startedAt: number
  waitMs: number
  networkMs: number
  status: number | null
  outcome: TelemetryOutcome
  bytes: number | null
  errorKind: string | null
  errorMessage: string | null
  appLimit: string | null
  appLimitCount: string | null
  methodLimit: string | null
  methodLimitCount: string | null
  retryAfterMs: number | null
}

export interface TelemetryRequestQuery {
  /** History to include, counted back from now. */
  windowMs: number
  endpoint?: string | null
  outcome?: TelemetryOutcome | null
  limit?: number
  /** Paging cursor — returns rows with an id below this. */
  beforeId?: number | null
}

export interface TelemetryEndpointStat {
  endpoint: string
  requests: number
  errors: number
  waitP95: number | null
  netP50: number | null
  netP95: number | null
  bytes: number
}

export interface TelemetrySummary {
  windowMs: number
  /** Attempts, including retries. */
  attempts: number
  /** Attempts collapsed by requestId — what the callers actually asked for. */
  logicalRequests: number
  errors: number
  throttled: number
  bytes: number
  waitP50: number | null
  waitP95: number | null
  netP50: number | null
  netP95: number | null
  byEndpoint: TelemetryEndpointStat[]
}

/**
 * Headroom against one of Riot's advertised windows, e.g. 100 requests per 120
 * seconds. Counts come from X-App-Rate-Limit-Count, so this is what Riot
 * counted rather than what the limiter believes it sent.
 */
export interface RateLimitWindowSeries {
  windowSeconds: number
  limit: number
  points: { at: number; count: number }[]
}

export interface RateLimitSeries {
  app: RateLimitWindowSeries[]
  method: RateLimitWindowSeries[]
  /** Timestamps of 429 responses, drawn as markers. */
  throttledAt: number[]
}

export interface ResourceSeries {
  processType: string
  points: { at: number; cpuPercent: number | null; workingSetKb: number | null }[]
}

export interface LoopDelayPoint {
  at: number
  meanMs: number | null
  p99Ms: number | null
  maxMs: number | null
  queueDepth: number | null
}

export interface ResourceData {
  series: ResourceSeries[]
  /** Main-process only: the best signal for "is the event loop blocked". */
  loopDelay: LoopDelayPoint[]
}

export interface LcuTelemetryEvent {
  at: number
  kind: string
  latencyMs: number | null
  detail: string | null
}

export interface LcuTelemetry {
  latency: { at: number; ms: number }[]
  recent: LcuTelemetryEvent[]
}
