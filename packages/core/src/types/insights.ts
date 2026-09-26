/**
 * What a Foxfire Server says about itself on its insights page: the requests it
 * answered, what it asked of Riot, the syncs it ran, the process underneath,
 * and its recent log lines.
 *
 * Shaped by the server — apps/server/src/Foxfire.Api/Features/Insights — and
 * read as sent. Every chart is a frame and a set of series: the frame says
 * where its points sit in time, and every series has one value per point.
 */
import type { PageOptions } from './domain'

/** The spans the page offers, and how finely each is drawn. */
export type InsightsWindow = '15m' | '1h' | '6h' | '24h' | '48h' | '7d' | '30d'

/** The page's tabs that are charts. The logs are a list of their own; see `ServerLogEntry`. */
export type InsightsSection = 'overview' | 'requests' | 'riot' | 'sync' | 'runtime'

/**
 * Where a response's points sit. Every series in it has `points` values, the
 * first starting at `from` and one every `stepMs` after it; the last is the
 * step still filling, so it is now.
 */
export interface InsightsFrame {
  window: InsightsWindow
  /** Epoch milliseconds. */
  from: number
  stepMs: number
  points: number
  now: number
  /**
   * Where the history starts, when that is after the window does — a fresh
   * install, a restart with nothing written down, or a month that retention has
   * trimmed. Null when the history covers the whole window.
   */
  historyFrom: number | null
  /** When the server process started. */
  startedAt: number
  /** Point by point, whether the server was running. A point it was not is null in every series. */
  up: boolean[]
}

/** One line on a chart. A null value is a gap: the server was down, or there was nothing to take a level of. */
export interface InsightSeries {
  key: string
  values: (number | null)[]
}

export interface InsightsOverview {
  frame: InsightsFrame
  serverVersion: string
  totals: {
    requests: number
    /** Requests answered 5xx. */
    serverErrors: number
    requestP95Ms: number | null
    riotCalls: number
    /** Riot calls answered 429. */
    riotThrottled: number
    syncRuns: number
    /** Runs that threw. A run that missed some matches is not counted here. */
    syncFailed: number
    warnings: number
    errors: number
  }
  now: {
    desktops: number
    webClients: number
    cpuPercent: number | null
    workingSetBytes: number
    syncsRunning: number
    riotQueued: number
    riotKeyRejected: boolean
  }
  /** requests, serverErrors, p95, riot, throttled, cpu, memory, warnings, errors. */
  series: InsightSeries[]
}

/** One route, over the window. */
export interface InsightsRouteStat {
  /** The route's template — `/api/riot-accounts/{id}/matches` — or `(static)` for the web client's files. */
  route: string
  method: string
  count: number
  clientErrors: number
  serverErrors: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface InsightsRequests {
  frame: InsightsFrame
  total: number
  p50Ms: number | null
  p95Ms: number | null
  /** Requests per point by status class: 2xx, 3xx, 4xx, 5xx. */
  byStatus: InsightSeries[]
  /** p50 and p95 per point, in milliseconds. */
  latency: InsightSeries[]
  /** Requests turned away per point, one series per rate-limit policy that turned any away. */
  rateLimited: InsightSeries[]
  /** The busiest routes, at most fifty. */
  routes: InsightsRouteStat[]
  /** desktop, web, and unnamed for anything that did not say. */
  clients: { kind: string; count: number; p95Ms: number | null }[]
}

/** One Riot endpoint, over the window. Every attempt counts, retries included. */
export interface InsightsEndpointStat {
  endpoint: string
  calls: number
  /** Failures other than a 404 or a 429, which have columns of their own. */
  errors: number
  throttled: number
  notFound: number
  p50Ms: number | null
  p95Ms: number | null
}

export interface InsightsRiot {
  frame: InsightsFrame
  total: number
  throttled: number
  /** Attempts per point by outcome: ok, not_found, throttled, server_error, client_error, key_rejected, network. */
  outcomes: InsightSeries[]
  /** The most of the burst and the sustained window seen spent in each point. */
  usage: InsightSeries[]
  /** The deepest each class's queue got in each point: interactive, post-game, backfill. */
  depth: InsightSeries[]
  /** p50 and p95 on the wire per point, in milliseconds. */
  latency: InsightSeries[]
  endpoints: InsightsEndpointStat[]
  /** How long each class of work waited for the shared queue. */
  priorities: { priority: string; requests: number; waitP50Ms: number | null; waitP95Ms: number | null }[]
  now: {
    keyRejected: boolean
    /** When a 429 or a 5xx has the queue held, until when. */
    pausedUntil: number | null
    windows: { name: 'burst' | 'sustained'; used: number; limit: number; windowSeconds: number }[]
    depths: Record<string, number>
  }
}

/** One sync run the server did recently. */
export interface InsightsSyncRun {
  accountId: string
  riotId: string | null
  trigger: 'manual' | 'auto'
  kind: 'backfill' | 'delta' | 'unknown'
  outcome: 'ok' | 'partial' | 'failed'
  startedAt: number
  durationMs: number
  stored: number
  failed: number
  /** For a run that failed, what the member was told. */
  error: string | null
}

export interface InsightsSync {
  frame: InsightsFrame
  totals: {
    runs: number
    manual: number
    auto: number
    failed: number
    /** Runs that stored some matches and missed others. */
    partial: number
    stored: number
    matchesFailed: number
    p50Ms: number | null
    p95Ms: number | null
  }
  now: { running: number; postGamePending: number }
  /** Runs finished per point by outcome: ok, partial, failed. */
  runs: InsightSeries[]
  /** p50 and p95 per point, in milliseconds. */
  duration: InsightSeries[]
  /** Matches stored and failed per point. */
  matches: InsightSeries[]
  /** The most syncs running, and post-game ladders waiting, in each point: running, postGame. */
  load: InsightSeries[]
  /** The last ten runs since the server started, newest first. */
  recent: InsightsSyncRun[]
}

/** Clients of one kind and version connected now. */
export interface InsightsClientGroup {
  kind: 'desktop' | 'web' | 'unnamed'
  /** A desktop's own version; for a browser, the API version its page was built for. */
  version: string
  count: number
  /** False for a desktop this server no longer serves — it will be refused on its next request. */
  supported: boolean
}

export interface InsightsRuntime {
  frame: InsightsFrame
  now: {
    cpuPercent: number | null
    workingSetBytes: number
    gcHeapBytes: number
    threadPoolQueue: number
    threadCount: number
    uptimeSeconds: number
  }
  dbCommands: number
  dbP95Ms: number | null
  /** Mean and peak, in percent of every core. */
  cpu: InsightSeries[]
  /** workingSet and gcHeap, in bytes. */
  memory: InsightSeries[]
  /** Milliseconds paused for garbage collection per point. */
  gcPause: InsightSeries[]
  threadPool: InsightSeries[]
  /** Exceptions thrown per point, caught or not. */
  exceptions: InsightSeries[]
  /** commands per point, and their p50 and p95. */
  database: InsightSeries[]
  /** desktop and web connected, per point. */
  clients: InsightSeries[]
  connected: InsightsClientGroup[]
  topExceptions: { type: string; count: number }[]
}

/** What each section of the page answers with. */
export interface InsightsSections {
  overview: InsightsOverview
  requests: InsightsRequests
  riot: InsightsRiot
  sync: InsightsSync
  runtime: InsightsRuntime
}

export type ServerLogLevel = 'information' | 'warning' | 'error' | 'fatal'

/** One of the server's recent log lines. */
export interface ServerLogEntry {
  /** Counts up from the first line the process wrote. What "Show more" pins itself to. */
  seq: number
  at: string
  level: ServerLogLevel
  /** Rendered, as it reads in the console. */
  message: string
  /** The class that wrote it. */
  source: string | null
  /** The request it was written during — what `X-Trace-Id` named. */
  traceId: string | null
  exception: string | null
}

/** Which of the server's recent log lines. */
export interface ServerLogQuery extends PageOptions {
  /** information (everything), warning (and worse), or error (and worse). */
  level?: 'information' | 'warning' | 'error'
  /** Only lines older than this sequence number — the first page's newest, plus one. */
  before?: number
}
