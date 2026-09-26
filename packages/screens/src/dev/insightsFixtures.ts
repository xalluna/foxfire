import type {
  InsightSeries,
  InsightsFrame,
  InsightsSection,
  InsightsSections,
  InsightsSyncRun,
  InsightsWindow,
  Page,
  ServerLogEntry,
  ServerLogQuery
} from '@foxfire/core'
import { pageOf } from '@foxfire/core'
import { delay, scenario } from './scenario'

/**
 * A server's insights, made up — for the harnesses.
 *
 * Shaped like a small community's evening: quiet mornings, a peak after
 * dinner, a Riot key that runs close to its sustained window during a
 * backfill, and the odd 429 and server error. Deterministic for a given moment,
 * so the page does not jitter between refetches; the newest point moves with
 * the clock like the real one.
 *
 * The server restarted forty minutes ago after being down for three, which
 * leaves a gap on every chart that reaches that far, and its history begins
 * nine days back — so a month says where it starts.
 *
 * `?scenario=insights-unsupported` is a server too old to have any, and
 * `server-degraded` one whose Riot key has been refused.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const WINDOWS: Record<InsightsWindow, { span: number; step: number }> = {
  '15m': { span: 15 * MINUTE, step: 10_000 },
  '1h': { span: HOUR, step: MINUTE },
  '6h': { span: 6 * HOUR, step: MINUTE },
  '24h': { span: DAY, step: 5 * MINUTE },
  '48h': { span: 2 * DAY, step: 10 * MINUTE },
  '7d': { span: 7 * DAY, step: HOUR },
  '30d': { span: 30 * DAY, step: 2 * HOUR }
}

const MB = 1024 * 1024

export function fixtureInsightsUnsupported(): boolean {
  return scenario === 'insights-unsupported'
}

function frameFor(window: InsightsWindow, now: number): InsightsFrame {
  const { span, step } = WINDOWS[window]
  const points = span / step
  const from = Math.floor(now / step) * step - step * (points - 1)

  const startedAt = now - 40 * MINUTE
  const downFrom = startedAt - 3 * MINUTE
  const historyStart = now - 9 * DAY

  const up = Array.from({ length: points }, (_, i) => {
    const at = from + i * step
    const end = at + step
    if (end <= historyStart) return false
    // Down for three minutes before the restart: a point wholly inside it is a gap.
    return !(at >= downFrom && end <= startedAt)
  })

  const first = up.indexOf(true)
  return {
    window,
    from,
    stepMs: step,
    points,
    now,
    historyFrom: first > 0 ? from + first * step : null,
    startedAt,
    up
  }
}

/** A smooth, repeatable wobble in [0, 1]. */
function wobble(at: number, seed: number): number {
  const t = at / (7 * MINUTE)
  return (Math.sin(t * 0.9 + seed) + Math.sin(t * 0.23 + seed * 1.7) + 2) / 4
}

/** How busy a community is at a time of day: quiet at breakfast, peaking late evening. */
function activity(at: number): number {
  const hour = new Date(at).getHours() + new Date(at).getMinutes() / 60
  const evening = Math.max(0, Math.sin(((hour - 13) / 12) * Math.PI))
  return 0.12 + 0.88 * evening * evening
}

/** Something that happens now and then — a 429, a 500 — on roughly one point in `every`. */
function sometimes(at: number, seed: number, every: number): boolean {
  const n = Math.floor(at / MINUTE) * 2654435761 + seed * 97
  return Math.abs(Math.sin(n)) * every < 1
}

function values(frame: InsightsFrame, value: (at: number, stepMinutes: number) => number | null): (number | null)[] {
  const stepMinutes = frame.stepMs / MINUTE
  return frame.up.map((up, i) => {
    if (!up) return null
    const v = value(frame.from + i * frame.stepMs, stepMinutes)
    return v === null ? null : Math.round(v * 100) / 100
  })
}

function series(key: string, v: (number | null)[]): InsightSeries {
  return { key, values: v }
}

const sum = (v: (number | null)[]): number => v.reduce<number>((total, x) => total + (x ?? 0), 0)
const last = (v: (number | null)[]): number | null => [...v].reverse().find((x) => x !== null) ?? null

function requestsPerMinute(at: number): number {
  return 38 * activity(at) * (0.7 + 0.6 * wobble(at, 1))
}

function riotPerMinute(at: number): number {
  // A backfill in the afternoon, on top of the evening's post-game syncs.
  const hour = new Date(at).getHours()
  const backfill = hour >= 15 && hour < 16 ? 30 : 0
  return backfill + 14 * activity(at) * wobble(at, 3)
}

function overview(frame: InsightsFrame): InsightsSections['overview'] {
  const requests = values(frame, (at, m) => Math.round(requestsPerMinute(at) * m))
  const serverErrors = values(frame, (at) => (sometimes(at, 11, 90) ? 1 : 0))
  const riot = values(frame, (at, m) => Math.round(riotPerMinute(at) * m))
  const throttled = values(frame, (at) => (sometimes(at, 5, 60) ? 1 + Math.round(wobble(at, 5)) : 0))
  const cpu = values(frame, (at) => 2 + 22 * activity(at) * wobble(at, 7))
  const memory = values(frame, (at) => 168 * MB + 46 * MB * wobble(at, 8))
  const warnings = values(frame, (at, m) => (sometimes(at, 13, 25) ? Math.max(1, Math.round(m)) : 0))
  const errors = values(frame, (at) => (sometimes(at, 17, 140) ? 1 : 0))

  return {
    frame,
    serverVersion: '0.5.0',
    totals: {
      requests: sum(requests),
      serverErrors: sum(serverErrors),
      requestP95Ms: 142,
      riotCalls: sum(riot),
      riotThrottled: sum(throttled),
      syncRuns: Math.round(sum(riot) / 9),
      syncFailed: sum(errors),
      warnings: sum(warnings),
      errors: sum(errors)
    },
    now: {
      desktops: 6,
      webClients: 2,
      cpuPercent: last(cpu),
      workingSetBytes: last(memory) ?? 180 * MB,
      syncsRunning: 1,
      riotQueued: 15,
      riotKeyRejected: scenario === 'server-degraded'
    },
    series: [
      series('requests', requests),
      series('serverErrors', serverErrors),
      series('p95', values(frame, (at) => 70 + 110 * wobble(at, 2))),
      series('riot', riot),
      series('throttled', throttled),
      series('cpu', cpu),
      series('memory', memory),
      series('warnings', warnings),
      series('errors', errors)
    ]
  }
}

const ROUTES: Array<[string, string, number, number]> = [
  // route, method, share of requests, typical ms
  ['/api/riot-accounts/{id}/matches', 'GET', 0.24, 38],
  ['/api/riot-accounts/{id}/rank/trend', 'GET', 0.14, 22],
  ['/api/search', 'GET', 0.12, 31],
  ['(static)', 'GET', 0.11, 3],
  ['/api/riot-accounts/mine', 'GET', 0.09, 12],
  ['/api/matches/{matchId}', 'GET', 0.07, 45],
  ['/api/riot-accounts/{id}/champions', 'GET', 0.06, 64],
  ['/api/sync/{riotAccountId}', 'POST', 0.05, 18],
  ['/api/riot-accounts/{id}/rank/history', 'GET', 0.04, 90],
  ['/api/auth/refresh', 'POST', 0.03, 140],
  ['/api/lcu/game-ended', 'POST', 0.02, 9],
  ['/api/replays/{matchId}/download', 'GET', 0.02, 260],
  ['/api/version', 'GET', 0.01, 1]
]

function requests(frame: InsightsFrame): InsightsSections['requests'] {
  const all = values(frame, (at, m) => Math.round(requestsPerMinute(at) * m))
  const total = sum(all)

  return {
    frame,
    total,
    p50Ms: 24,
    p95Ms: 142,
    byStatus: [
      series('2xx', all.map((v) => (v === null ? null : Math.round(v * 0.93)))),
      series('3xx', all.map((v) => (v === null ? null : Math.round(v * 0.02)))),
      series('4xx', all.map((v) => (v === null ? null : Math.round(v * 0.05)))),
      series('5xx', values(frame, (at) => (sometimes(at, 11, 90) ? 1 : 0)))
    ],
    latency: [
      series('p50', values(frame, (at) => 14 + 18 * wobble(at, 4))),
      series('p95', values(frame, (at) => 70 + 110 * wobble(at, 2)))
    ],
    rateLimited: [series('auth', values(frame, (at) => (sometimes(at, 23, 300) ? 3 : 0)))],
    routes: ROUTES.map(([route, method, share, ms], i) => {
      const count = Math.round(total * share)
      return {
        route,
        method,
        count,
        clientErrors: route === '/api/auth/refresh' ? Math.round(count * 0.2) : i % 4 === 0 ? Math.round(count * 0.01) : 0,
        serverErrors: i === 5 ? 2 : 0,
        p50Ms: ms,
        p95Ms: Math.round(ms * 3.2),
        maxMs: Math.round(ms * 9.5)
      }
    }),
    clients: [
      { kind: 'desktop', count: Math.round(total * 0.71), p95Ms: 118 },
      { kind: 'web', count: Math.round(total * 0.27), p95Ms: 176 },
      { kind: 'unnamed', count: Math.round(total * 0.02), p95Ms: 4 }
    ]
  }
}

const ENDPOINTS: Array<[string, number, number]> = [
  ['/lol/match/v5/matches/{matchId}', 0.62, 180],
  ['/lol/match/v5/matches/by-puuid/{puuid}/ids', 0.14, 95],
  ['/lol/league/v4/entries/by-puuid/{puuid}', 0.1, 70],
  ['/lol/summoner/v4/summoners/by-puuid/{puuid}', 0.06, 65],
  ['/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}', 0.05, 110],
  ['/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}', 0.02, 120],
  ['/lol/status/v4/platform-data', 0.01, 60]
]

function riot(frame: InsightsFrame): InsightsSections['riot'] {
  const ok = values(frame, (at, m) => Math.round(riotPerMinute(at) * m * 0.93))
  const notFound = values(frame, (at, m) => Math.round(riotPerMinute(at) * m * 0.05))
  const throttled = values(frame, (at) => (sometimes(at, 5, 60) ? 1 + Math.round(wobble(at, 5)) : 0))
  const serverError = values(frame, (at) => (sometimes(at, 29, 200) ? 1 : 0))
  const total = sum(ok) + sum(notFound) + sum(throttled) + sum(serverError)
  const keyRejected = scenario === 'server-degraded'

  return {
    frame,
    total,
    throttled: sum(throttled),
    outcomes: [
      series('ok', ok),
      series('not_found', notFound),
      series('throttled', throttled),
      series('server_error', serverError)
    ],
    usage: [
      series('burst', values(frame, (at) => Math.min(20, Math.round(3 + 15 * wobble(at, 9))))),
      series('sustained', values(frame, (at) => Math.min(100, Math.round(riotPerMinute(at) * 2.1))))
    ],
    depth: [
      series('interactive', values(frame, (at) => (sometimes(at, 31, 12) ? 1 : 0))),
      series('post-game', values(frame, (at) => Math.round(3 * activity(at) * wobble(at, 12)))),
      series('backfill', values(frame, (at) => (new Date(at).getHours() === 15 ? Math.round(160 * (1 - new Date(at).getMinutes() / 60)) : 0)))
    ],
    latency: [
      series('p50', values(frame, (at) => 70 + 40 * wobble(at, 14))),
      series('p95', values(frame, (at) => 190 + 260 * wobble(at, 15)))
    ],
    endpoints: ENDPOINTS.map(([endpoint, share, ms]) => {
      const calls = Math.round(total * share)
      return {
        endpoint,
        calls,
        errors: endpoint.includes('matches/{matchId}') ? sum(serverError) : 0,
        throttled: Math.round(sum(throttled) * share),
        notFound: endpoint.includes('league') ? Math.round(calls * 0.3) : 0,
        p50Ms: ms,
        p95Ms: Math.round(ms * 2.6)
      }
    }),
    priorities: [
      { priority: 'interactive', requests: Math.round(total * 0.04), waitP50Ms: 2, waitP95Ms: 380 },
      { priority: 'post-game', requests: Math.round(total * 0.36), waitP50Ms: 40, waitP95Ms: 2_300 },
      { priority: 'backfill', requests: Math.round(total * 0.6), waitP50Ms: 21_000, waitP95Ms: 118_000 }
    ],
    now: {
      keyRejected,
      pausedUntil: null,
      windows: [
        { name: 'burst', used: keyRejected ? 0 : 4, limit: 20, windowSeconds: 1 },
        { name: 'sustained', used: keyRejected ? 0 : 63, limit: 100, windowSeconds: 120 }
      ],
      depths: { interactive: 0, 'post-game': 1, backfill: keyRejected ? 0 : 14 }
    }
  }
}

const PLAYERS = ['Ahri Main#EUW', 'SoloQ Hero#NA1', 'Nami Enjoyer#EUW', 'Jungle Diff#NA1', 'Mid or Feed#OCE']

function sync(frame: InsightsFrame): InsightsSections['sync'] {
  const ok = values(frame, (at, m) => Math.round(1.6 * activity(at) * m * wobble(at, 20)))
  const partial = values(frame, (at) => (sometimes(at, 21, 70) ? 1 : 0))
  const failed = values(frame, (at) => (sometimes(at, 17, 140) ? 1 : 0))
  const stored = values(frame, (at, m) => Math.round(1.9 * activity(at) * m * wobble(at, 22)))
  const runs = sum(ok) + sum(partial) + sum(failed)

  const now = frame.now
  const recent: InsightsSyncRun[] = Array.from({ length: 10 }, (_, i) => {
    const outcome = i === 3 ? 'failed' : i === 6 ? 'partial' : 'ok'
    return {
      accountId: `acc-${i}`,
      riotId: PLAYERS[i % PLAYERS.length],
      trigger: i % 3 === 0 ? 'manual' : 'auto',
      kind: i === 8 ? 'backfill' : outcome === 'failed' ? 'unknown' : 'delta',
      outcome,
      startedAt: now - (i * 7 + 2) * MINUTE,
      durationMs: i === 8 ? 184_000 : 1_200 + i * 430,
      stored: outcome === 'failed' ? 0 : i === 8 ? 200 : 1 + (i % 3),
      failed: outcome === 'partial' ? 2 : 0,
      error: outcome === 'failed' ? 'Riot is rate limiting this server. Syncing again shortly should work.' : null
    }
  })

  return {
    frame,
    totals: {
      runs,
      manual: Math.round(runs * 0.3),
      auto: runs - Math.round(runs * 0.3),
      failed: sum(failed),
      partial: sum(partial),
      stored: sum(stored),
      matchesFailed: sum(partial) * 2,
      p50Ms: 1_840,
      p95Ms: 9_400
    },
    now: { running: 1, postGamePending: 2 },
    runs: [series('ok', ok), series('partial', partial), series('failed', failed)],
    duration: [
      series('p50', values(frame, (at) => 1_200 + 1_400 * wobble(at, 24))),
      series('p95', values(frame, (at) => 5_000 + 9_000 * wobble(at, 25)))
    ],
    matches: [
      series('stored', stored),
      series('failed', partial.map((v) => (v === null ? null : v * 2)))
    ],
    load: [
      series('running', values(frame, (at) => Math.round(2 * activity(at) * wobble(at, 26)))),
      series('postGame', values(frame, (at) => Math.round(4 * activity(at) * wobble(at, 27))))
    ],
    recent
  }
}

function runtime(frame: InsightsFrame): InsightsSections['runtime'] {
  const cpu = values(frame, (at) => 2 + 22 * activity(at) * wobble(at, 7))
  const memory = values(frame, (at) => 168 * MB + 46 * MB * wobble(at, 8))
  const commands = values(frame, (at, m) => Math.round(requestsPerMinute(at) * m * 2.4))

  return {
    frame,
    now: {
      cpuPercent: last(cpu),
      workingSetBytes: last(memory) ?? 180 * MB,
      gcHeapBytes: 64 * MB,
      threadPoolQueue: 0,
      threadCount: 14,
      uptimeSeconds: Math.round((frame.now - frame.startedAt) / 1000)
    },
    dbCommands: sum(commands),
    dbP95Ms: 11.4,
    cpu: [series('mean', cpu), series('peak', cpu.map((v) => (v === null ? null : Math.min(100, v * 2.3))))],
    memory: [series('workingSet', memory), series('gcHeap', values(frame, (at) => 48 * MB + 30 * MB * wobble(at, 30)))],
    gcPause: [series('pause', values(frame, (at, m) => 1.5 * m * wobble(at, 31)))],
    threadPool: [series('queue', values(frame, (at) => (sometimes(at, 33, 40) ? 3 : 0)))],
    exceptions: [series('thrown', values(frame, (at, m) => Math.round(2 * m * activity(at) * wobble(at, 34))))],
    database: [
      series('commands', commands),
      series('p50', values(frame, (at) => 1.2 + 1.5 * wobble(at, 35))),
      series('p95', values(frame, (at) => 6 + 14 * wobble(at, 36)))
    ],
    clients: [
      series('desktop', values(frame, (at) => Math.round(1 + 6 * activity(at)))),
      series('web', values(frame, (at) => Math.round(3 * activity(at) * wobble(at, 37))))
    ],
    connected: [
      { kind: 'desktop', version: '0.16.0', count: 5, supported: true },
      { kind: 'web', version: 'api 3', count: 2, supported: true },
      { kind: 'desktop', version: '0.15.0', count: 1, supported: false }
    ],
    topExceptions: [
      { type: 'OperationCanceledException', count: 214 },
      { type: 'RiotApiException', count: 41 },
      { type: 'SqlException', count: 3 }
    ]
  }
}

const BUILDERS: { [S in InsightsSection]: (frame: InsightsFrame) => InsightsSections[S] } = {
  overview,
  requests,
  riot,
  sync,
  runtime
}

export function fixtureInsights<S extends InsightsSection>(
  section: S,
  window: InsightsWindow
): Promise<InsightsSections[S] | null> {
  if (fixtureInsightsUnsupported()) return delay(null, 200)
  const build = BUILDERS[section] as (frame: InsightsFrame) => InsightsSections[S]
  return delay(build(frameFor(window, Date.now())), 260)
}

/** A couple of hundred lines, mostly requests, with the warnings and errors a real evening has. */
function logLines(now: number): ServerLogEntry[] {
  const lines: ServerLogEntry[] = []

  for (let i = 0; i < 220; i++) {
    const seq = 5_000 + i
    const at = new Date(now - (220 - i) * 23_000).toISOString()
    const trace = `${(seq * 2654435761).toString(16).padStart(8, '0')}${'0af3c1d2'.repeat(3)}`.slice(0, 32)

    if (i % 37 === 11) {
      lines.push({
        seq,
        at,
        level: 'warning',
        message: 'Riot returned 429; pausing 00:00:02 and retrying (attempt 1 of 3)',
        source: 'RiotRateLimiter',
        traceId: null,
        exception: null
      })
    } else if (i % 71 === 40) {
      lines.push({
        seq,
        at,
        level: 'error',
        message: `Sync failed for Riot account ${'019284a0-6b1f-7c55-9a3e-'}${String(i).padStart(12, '0')}`,
        source: 'SyncService',
        traceId: null,
        exception:
          'Foxfire.Riot.RiotApiException: Riot API error 503 for /lol/match/v5/matches/{matchId}\n'
          + '   at Foxfire.Riot.RiotClient.SendRawAsync(String endpoint, Uri baseUrl, String path, RiotRequestPriority priority, CancellationToken cancellationToken)\n'
          + '   at Foxfire.Api.Sync.SyncService.FetchAndStoreAsync(...)'
      })
    } else if (i % 53 === 7) {
      lines.push({
        seq,
        at,
        level: 'warning',
        message: 'Turned away "203.0.113.24" by the "auth" limit; retry in 41s',
        source: 'RateLimits',
        traceId: trace,
        exception: null
      })
    } else {
      const [route, method] = ROUTES[i % ROUTES.length]
      const path = route === '(static)' ? '/assets/index-3f9c.js' : route.replace('{id}', '019284a0').replace('{matchId}', 'EUW1_7132004')
      lines.push({
        seq,
        at,
        level: 'information',
        message: `HTTP ${method} ${path} responded 200 in ${(8 + ((i * 37) % 90)).toFixed(4)} ms`,
        source: 'RequestLoggingMiddleware',
        traceId: trace,
        exception: null
      })
    }
  }

  return lines
}

export function fixtureServerLogs(query: ServerLogQuery = {}): Promise<Page<ServerLogEntry> | null> {
  if (fixtureInsightsUnsupported()) return delay(null, 200)

  const rank = { information: 0, warning: 1, error: 2, fatal: 3 }
  const minimum = rank[query.level ?? 'information']

  const matching = logLines(Date.now())
    .filter((line) => rank[line.level] >= minimum && (query.before === undefined || line.seq < query.before))
    .reverse()

  return delay(pageOf(matching, query), 220)
}
