import {
  insightSeries,
  type InsightsOverview,
  type InsightsRequests,
  type InsightsRiot,
  type InsightsRuntime,
  type InsightsSync
} from '@foxfire/core'
import { Bar } from '../../components/Bar'
import { formatBytes, formatMs, formatUptime } from '../../lib/format'
import { formatAge } from '../../lib/matchStats'
import {
  COLOUR,
  Chip,
  InsightChart,
  Table,
  Tile,
  Tiles,
  count,
  counted,
  markersWhere,
  percent,
  percentValue,
  type Tone
} from './parts'

const perPoint = (value: number): string => (value >= 100 ? count(value) : String(Math.round(value * 10) / 10))

/** Is the server all right, and has it been. */
export function OverviewTab({ data }: { data: InsightsOverview }): JSX.Element {
  const { frame, totals, now } = data

  return (
    <div className="space-y-6">
      <Tiles>
        <Tile
          label="Requests"
          value={count(totals.requests)}
          detail={totals.requestP95Ms === null ? 'nothing answered yet' : `p95 ${formatMs(totals.requestP95Ms)}`}
        />
        <Tile
          label="Server errors"
          value={count(totals.serverErrors)}
          detail={`${percent(totals.serverErrors, totals.requests)} of requests`}
          tone={totals.serverErrors > 0 ? 'bad' : 'good'}
        />
        <Tile
          label="Riot calls"
          value={count(totals.riotCalls)}
          detail={now.riotKeyRejected ? 'the key is refused' : `${count(totals.riotThrottled)} throttled`}
          tone={now.riotKeyRejected ? 'bad' : totals.riotThrottled > 0 ? 'warn' : 'normal'}
        />
        <Tile
          label="Syncs"
          value={count(totals.syncRuns)}
          detail={now.syncsRunning > 0 ? `${now.syncsRunning} running now` : `${count(totals.syncFailed)} failed`}
          tone={totals.syncFailed > 0 ? 'warn' : 'normal'}
        />
        <Tile
          label="Connected"
          value={count(now.desktops + now.webClients)}
          detail={`${now.desktops} desktop · ${now.webClients} web`}
        />
        <Tile label="CPU" value={percentValue(now.cpuPercent)} detail="of every core, now" />
        <Tile label="Memory" value={formatBytes(now.workingSetBytes)} detail="working set, now" />
        <Tile
          label="Problems logged"
          value={count(totals.warnings + totals.errors)}
          detail={`${counted(totals.warnings, 'warning')} · ${counted(totals.errors, 'error')}`}
          tone={totals.errors > 0 ? 'bad' : totals.warnings > 0 ? 'warn' : 'good'}
        />
      </Tiles>

      <InsightChart
        title="Requests"
        hint="answered per point, and the ones that failed"
        frame={frame}
        source={data.series}
        format={perPoint}
        lines={[
          { key: 'requests', label: 'All', colour: COLOUR.teal, step: true, fill: true },
          { key: 'serverErrors', label: '5xx', colour: COLOUR.red, step: true }
        ]}
      />
      <InsightChart
        title="Response time"
        hint="p95 — nineteen requests in twenty were quicker"
        frame={frame}
        source={data.series}
        format={(v) => formatMs(v)}
        lines={[{ key: 'p95', label: 'p95', colour: COLOUR.accent }]}
      />
      <InsightChart
        title="Riot API"
        hint="calls per point; a mark at every 429"
        frame={frame}
        source={data.series}
        format={perPoint}
        markers={markersWhere(frame, insightSeries(data.series, 'throttled'))}
        lines={[{ key: 'riot', label: 'Calls', colour: COLOUR.gold, step: true, fill: true }]}
      />
      <InsightChart
        title="CPU"
        hint="the server's share of every core"
        frame={frame}
        source={data.series}
        format={(v) => `${Math.round(v)}%`}
        lines={[{ key: 'cpu', label: 'CPU', colour: COLOUR.accent }]}
      />
      <InsightChart
        title="Memory"
        hint="working set"
        frame={frame}
        source={data.series}
        format={(v) => formatBytes(v)}
        lines={[{ key: 'memory', label: 'Working set', colour: COLOUR.teal }]}
      />
      <InsightChart
        title="Problems logged"
        hint="warnings and errors written to the log"
        frame={frame}
        source={data.series}
        format={perPoint}
        lines={[
          { key: 'warnings', label: 'Warnings', colour: COLOUR.amber, step: true },
          { key: 'errors', label: 'Errors', colour: COLOUR.red, step: true }
        ]}
      />
    </div>
  )
}

/** What the API was asked, how it answered, and how quickly. */
export function RequestsTab({ data }: { data: InsightsRequests }): JSX.Element {
  const { frame } = data
  const serverErrors = data.routes.reduce((sum, r) => sum + r.serverErrors, 0)
  const clientErrors = data.routes.reduce((sum, r) => sum + r.clientErrors, 0)

  return (
    <div className="space-y-6">
      <Tiles>
        <Tile label="Requests" value={count(data.total)} />
        <Tile label="p50" value={formatMs(data.p50Ms)} detail="half were quicker" />
        <Tile label="p95" value={formatMs(data.p95Ms)} detail="nineteen in twenty were quicker" />
        <Tile
          label="Errors"
          value={percent(serverErrors, data.total)}
          detail={`${count(serverErrors)} 5xx · ${count(clientErrors)} 4xx`}
          tone={serverErrors > 0 ? 'bad' : 'good'}
        />
      </Tiles>

      <InsightChart
        title="By status"
        hint="requests per point"
        frame={frame}
        source={data.byStatus}
        format={perPoint}
        lines={[
          { key: '2xx', label: '2xx', colour: COLOUR.teal, step: true },
          { key: '3xx', label: '3xx', colour: COLOUR.accentDim, step: true },
          { key: '4xx', label: '4xx', colour: COLOUR.amber, step: true },
          { key: '5xx', label: '5xx', colour: COLOUR.red, step: true }
        ]}
      />
      <InsightChart
        title="Response time"
        frame={frame}
        source={data.latency}
        format={(v) => formatMs(v)}
        lines={[
          { key: 'p50', label: 'p50', colour: COLOUR.teal },
          { key: 'p95', label: 'p95', colour: COLOUR.accent }
        ]}
      />
      {data.rateLimited.length > 0 && (
        <InsightChart
          title="Turned away"
          hint="by the per-address limits on signing in and searching"
          frame={frame}
          source={data.rateLimited}
          format={perPoint}
          lines={data.rateLimited.map((s, i) => ({
            key: s.key,
            label: s.key,
            colour: i === 0 ? COLOUR.amber : COLOUR.red,
            step: true
          }))}
        />
      )}

      <Table
        title="Busiest routes"
        description="The fifty most-asked, over this window. (static) is the web client's own files."
        rows={data.routes}
        rowKey={(r) => `${r.method} ${r.route}`}
        empty="Nothing asked in this window."
        columns={[
          {
            header: 'Route',
            cell: (r) => (
              <span className="font-mono">
                <span className="text-text-mute">{r.method}</span> <span className="text-text">{r.route}</span>
              </span>
            )
          },
          { header: 'Count', numeric: true, cell: (r) => count(r.count) },
          { header: '4xx', numeric: true, cell: (r) => (r.clientErrors ? count(r.clientErrors) : '·') },
          {
            header: '5xx',
            numeric: true,
            cell: (r) => (r.serverErrors ? <span className="text-red">{count(r.serverErrors)}</span> : '·')
          },
          { header: 'p50', numeric: true, cell: (r) => formatMs(r.p50Ms) },
          { header: 'p95', numeric: true, cell: (r) => formatMs(r.p95Ms) },
          { header: 'Max', numeric: true, cell: (r) => formatMs(r.maxMs) }
        ]}
      />

      <Table
        title="Who asked"
        rows={data.clients}
        rowKey={(c) => c.kind}
        empty="Nobody asked in this window."
        columns={[
          { header: 'Client', cell: (c) => <span className="text-text">{clientName(c.kind)}</span> },
          { header: 'Requests', numeric: true, cell: (c) => count(c.count) },
          { header: 'p95', numeric: true, cell: (c) => formatMs(c.p95Ms) }
        ]}
      />
    </div>
  )
}

/** What the server asked of Riot, and how much of the key it spent. */
export function RiotTab({ data }: { data: InsightsRiot }): JSX.Element {
  const { frame, now } = data
  const sustained = now.windows.find((w) => w.name === 'sustained')
  const p95 = insightSeries(data.latency, 'p95')?.values.filter((v): v is number => v !== null) ?? []

  return (
    <div className="space-y-6">
      {now.keyRejected && (
        <p className="rounded-lg border border-red/40 bg-red/10 px-4 py-3 text-sm text-red">
          Riot has refused this server&apos;s API key. Stored data still reads, but nothing new is fetched
          until the key is replaced and the server restarted.
        </p>
      )}

      <section className="rounded-lg border border-hairline bg-surface px-4 py-3">
        <div className="grid gap-4 sm:grid-cols-2">
          {now.windows.map((w) => (
            <div key={w.name}>
              <div className="flex items-baseline justify-between text-2xs">
                <span className="font-medium uppercase tracking-widest text-text-mute">
                  {w.name === 'burst' ? 'Burst' : 'Sustained'} · {w.limit} per {windowName(w.windowSeconds)}
                </span>
                <span className="font-mono tabular-nums text-text">
                  {w.used} / {w.limit}
                </span>
              </div>
              <Bar fraction={w.limit === 0 ? 0 : w.used / w.limit} tone={w.used >= w.limit ? 'taken' : 'accent'} className="mt-1.5" />
            </div>
          ))}
        </div>
        <p className="mt-3 text-2xs text-text-dim">
          Waiting now: {Object.entries(now.depths).map(([name, depth]) => `${depth} ${name}`).join(' · ')}
          {now.pausedUntil !== null && now.pausedUntil > Date.now() && (
            <span className="text-amber"> · held after a refusal for {Math.ceil((now.pausedUntil - Date.now()) / 1000)}s</span>
          )}
        </p>
      </section>

      <Tiles>
        <Tile label="Calls" value={count(data.total)} detail="every attempt, retries included" />
        <Tile
          label="Throttled"
          value={count(data.throttled)}
          detail={`${percent(data.throttled, data.total)} of calls`}
          tone={data.throttled > 0 ? 'warn' : 'good'}
        />
        <Tile
          label="Slowest point"
          value={formatMs(p95.length ? Math.max(...p95) : null)}
          detail="worst p95 on the wire"
        />
        <Tile
          label="Waiting now"
          value={count(Object.values(now.depths).reduce((a, b) => a + b, 0))}
          detail="across every class"
        />
      </Tiles>

      <InsightChart
        title="Calls by outcome"
        hint="attempts per point; a mark at every 429"
        frame={frame}
        source={data.outcomes}
        format={perPoint}
        markers={markersWhere(frame, insightSeries(data.outcomes, 'throttled'))}
        lines={data.outcomes.map((s) => ({
          key: s.key,
          label: outcomeLabel(s.key),
          colour: outcomeColour(s.key),
          step: true
        }))}
      />
      {sustained && (
        <InsightChart
          title="Sustained window"
          hint={`the most of the ${sustained.limit} per ${windowName(sustained.windowSeconds)} in use at once`}
          frame={frame}
          source={data.usage}
          format={perPoint}
          threshold={{ value: sustained.limit, label: `${sustained.limit} limit` }}
          lines={[{ key: 'sustained', label: 'In use', colour: COLOUR.gold, fill: true }]}
        />
      )}
      <InsightChart
        title="Queue"
        hint="the most waiting in each class"
        frame={frame}
        source={data.depth}
        format={perPoint}
        lines={[
          { key: 'interactive', label: 'Interactive', colour: COLOUR.accent, step: true },
          { key: 'post-game', label: 'Post-game', colour: COLOUR.teal, step: true },
          { key: 'backfill', label: 'Backfill', colour: COLOUR.dim, step: true }
        ]}
      />
      <InsightChart
        title="Time on the wire"
        hint="Riot's own answer time, not the queue's"
        frame={frame}
        source={data.latency}
        format={(v) => formatMs(v)}
        lines={[
          { key: 'p50', label: 'p50', colour: COLOUR.teal },
          { key: 'p95', label: 'p95', colour: COLOUR.accent }
        ]}
      />

      <Table
        title="Endpoints"
        rows={data.endpoints}
        rowKey={(e) => e.endpoint}
        empty="No calls to Riot in this window."
        columns={[
          {
            header: 'Endpoint',
            cell: (e) => <span className="font-mono text-text">{e.endpoint.replace(/^\/(lol|riot)\//, '')}</span>
          },
          { header: 'Calls', numeric: true, cell: (e) => count(e.calls) },
          { header: '404', numeric: true, cell: (e) => (e.notFound ? count(e.notFound) : '·') },
          {
            header: '429',
            numeric: true,
            cell: (e) => (e.throttled ? <span className="text-amber">{count(e.throttled)}</span> : '·')
          },
          {
            header: 'Errors',
            numeric: true,
            cell: (e) => (e.errors ? <span className="text-red">{count(e.errors)}</span> : '·')
          },
          { header: 'p50', numeric: true, cell: (e) => formatMs(e.p50Ms) },
          { header: 'p95', numeric: true, cell: (e) => formatMs(e.p95Ms) }
        ]}
      />

      <Table
        title="Waiting for the queue"
        description="How long each class waited before its first attempt went out. Backfill waits by design."
        rows={data.priorities}
        rowKey={(p) => p.priority}
        empty="Nothing queued in this window."
        columns={[
          { header: 'Class', cell: (p) => <span className="capitalize text-text">{p.priority}</span> },
          { header: 'Requests', numeric: true, cell: (p) => count(p.requests) },
          { header: 'Wait p50', numeric: true, cell: (p) => formatMs(p.waitP50Ms) },
          { header: 'Wait p95', numeric: true, cell: (p) => formatMs(p.waitP95Ms) }
        ]}
      />
    </div>
  )
}

/** How the server has been keeping everybody's history up to date. */
export function SyncTab({ data }: { data: InsightsSync }): JSX.Element {
  const { frame, totals, now } = data

  return (
    <div className="space-y-6">
      <Tiles>
        <Tile
          label="Runs"
          value={count(totals.runs)}
          detail={`${count(totals.manual)} asked for · ${count(totals.auto)} automatic`}
        />
        <Tile
          label="Failed"
          value={count(totals.failed)}
          detail={`${counted(totals.partial, 'run')} left gaps`}
          tone={totals.failed > 0 ? 'bad' : totals.partial > 0 ? 'warn' : 'good'}
        />
        <Tile
          label="Matches stored"
          value={count(totals.stored)}
          detail={totals.matchesFailed ? `${count(totals.matchesFailed)} to retry` : 'none missed'}
          tone={totals.matchesFailed > 0 ? 'warn' : 'normal'}
        />
        <Tile label="Duration" value={formatMs(totals.p50Ms)} detail={`p95 ${formatMs(totals.p95Ms)}`} />
      </Tiles>

      <p className="text-2xs text-text-dim">
        Now: {now.running} {now.running === 1 ? 'sync' : 'syncs'} running · {now.postGamePending} waiting for
        a game Riot has not published yet
      </p>

      <InsightChart
        title="Runs"
        hint="finished per point"
        frame={frame}
        source={data.runs}
        format={perPoint}
        lines={[
          { key: 'ok', label: 'Complete', colour: COLOUR.teal, step: true },
          { key: 'partial', label: 'Left gaps', colour: COLOUR.amber, step: true },
          { key: 'failed', label: 'Failed', colour: COLOUR.red, step: true }
        ]}
      />
      <InsightChart
        title="How long a run takes"
        frame={frame}
        source={data.duration}
        format={(v) => formatMs(v)}
        lines={[
          { key: 'p50', label: 'p50', colour: COLOUR.teal },
          { key: 'p95', label: 'p95', colour: COLOUR.accent }
        ]}
      />
      <InsightChart
        title="Matches"
        hint="stored, and not fetched this time"
        frame={frame}
        source={data.matches}
        format={perPoint}
        lines={[
          { key: 'stored', label: 'Stored', colour: COLOUR.teal, step: true, fill: true },
          { key: 'failed', label: 'Missed', colour: COLOUR.red, step: true }
        ]}
      />
      <InsightChart
        title="Load"
        hint="the most running, and waiting on Riot, at once"
        frame={frame}
        source={data.load}
        format={perPoint}
        lines={[
          { key: 'running', label: 'Running', colour: COLOUR.accent, step: true },
          { key: 'postGame', label: 'Post-game', colour: COLOUR.gold, step: true }
        ]}
      />

      <Table
        title="Latest runs"
        description="The last ten since the server started, newest first."
        rows={data.recent}
        rowKey={(r) => `${r.accountId}-${r.startedAt}`}
        empty="No syncs since the server started."
        columns={[
          {
            header: 'Account',
            cell: (r) => (
              <div className="min-w-0">
                <span className="text-text">{r.riotId ?? r.accountId.slice(0, 8)}</span>
                {r.error && <p className="mt-0.5 max-w-xs text-2xs text-red">{r.error}</p>}
              </div>
            )
          },
          {
            header: 'Outcome',
            cell: (r) => <Chip tone={syncTone(r.outcome)}>{syncOutcome(r.outcome)}</Chip>
          },
          { header: 'Kind', cell: (r) => `${r.kind}${r.trigger === 'manual' ? ', asked for' : ''}` },
          { header: 'When', cell: (r) => formatAge(r.startedAt) },
          { header: 'Took', numeric: true, cell: (r) => formatMs(r.durationMs) },
          {
            header: 'Stored',
            numeric: true,
            cell: (r) => (r.failed ? `${r.stored} (${r.failed} missed)` : String(r.stored))
          }
        ]}
      />
    </div>
  )
}

/** The process itself, and who is connected to it. */
export function RuntimeTab({ data }: { data: InsightsRuntime }): JSX.Element {
  const { frame, now } = data
  const unsupported = data.connected.filter((c) => !c.supported).reduce((sum, c) => sum + c.count, 0)

  return (
    <div className="space-y-6">
      <Tiles>
        <Tile label="CPU" value={percentValue(now.cpuPercent)} detail="of every core" />
        <Tile label="Working set" value={formatBytes(now.workingSetBytes)} detail={`heap ${formatBytes(now.gcHeapBytes)}`} />
        <Tile
          label="Thread pool"
          value={count(now.threadPoolQueue)}
          detail={`waiting · ${counted(now.threadCount, 'thread')}`}
          tone={now.threadPoolQueue > 50 ? 'warn' : 'normal'}
        />
        <Tile label="Up for" value={formatUptime(now.uptimeSeconds)} detail="since the last restart" />
      </Tiles>

      <InsightChart
        title="CPU"
        hint="the mean of each point, and its peak"
        frame={frame}
        source={data.cpu}
        format={(v) => `${Math.round(v)}%`}
        lines={[
          { key: 'mean', label: 'Mean', colour: COLOUR.accent, fill: true },
          { key: 'peak', label: 'Peak', colour: COLOUR.amber }
        ]}
      />
      <InsightChart
        title="Memory"
        frame={frame}
        source={data.memory}
        format={(v) => formatBytes(v)}
        lines={[
          { key: 'workingSet', label: 'Working set', colour: COLOUR.teal },
          { key: 'gcHeap', label: 'Managed heap', colour: COLOUR.accent }
        ]}
      />
      <InsightChart
        title="Database"
        hint={`${count(data.dbCommands)} commands · p95 ${formatMs(data.dbP95Ms)}`}
        frame={frame}
        source={data.database}
        format={(v) => formatMs(v)}
        lines={[
          { key: 'p50', label: 'p50', colour: COLOUR.teal },
          { key: 'p95', label: 'p95', colour: COLOUR.accent }
        ]}
      />
      <InsightChart
        title="Database commands"
        hint="per point"
        frame={frame}
        source={data.database}
        format={perPoint}
        lines={[{ key: 'commands', label: 'Commands', colour: COLOUR.gold, step: true, fill: true }]}
      />
      <InsightChart
        title="Connected"
        hint="desktops and browser tabs holding the server open"
        frame={frame}
        source={data.clients}
        format={perPoint}
        lines={[
          { key: 'desktop', label: 'Desktop', colour: COLOUR.accent },
          { key: 'web', label: 'Web', colour: COLOUR.teal }
        ]}
      />
      <InsightChart
        title="Garbage collection"
        hint="milliseconds paused per point"
        frame={frame}
        source={data.gcPause}
        format={(v) => formatMs(v)}
        lines={[{ key: 'pause', label: 'Paused', colour: COLOUR.dim, step: true }]}
      />
      <InsightChart
        title="Exceptions"
        hint="thrown per point, caught or not — most are handled"
        frame={frame}
        source={data.exceptions}
        format={perPoint}
        lines={[{ key: 'thrown', label: 'Thrown', colour: COLOUR.amber, step: true }]}
      />

      <Table
        title="Connected now"
        description={
          unsupported > 0
            ? `${unsupported === 1 ? 'One desktop is' : `${unsupported} desktops are`} on a version this server no longer serves. The next request ${unsupported === 1 ? 'it makes' : 'each makes'} is refused, and asks it to update.`
            : 'By client and version.'
        }
        rows={data.connected}
        rowKey={(c) => `${c.kind}-${c.version}`}
        empty="Nobody is connected."
        columns={[
          { header: 'Client', cell: (c) => <span className="text-text">{clientName(c.kind)}</span> },
          {
            header: 'Version',
            cell: (c) => (
              <span className="flex items-center gap-2 font-mono">
                {c.version || '—'}
                {!c.supported && <Chip tone="warn">no longer served</Chip>}
              </span>
            )
          },
          { header: 'Connected', numeric: true, cell: (c) => count(c.count) }
        ]}
      />

      <Table
        title="Exceptions by type"
        description="The ten thrown most in this window."
        rows={data.topExceptions}
        rowKey={(e) => e.type}
        empty="None thrown in this window."
        columns={[
          { header: 'Type', cell: (e) => <span className="font-mono text-text">{e.type}</span> },
          { header: 'Thrown', numeric: true, cell: (e) => count(e.count) }
        ]}
      />
    </div>
  )
}

function clientName(kind: string): string {
  switch (kind) {
    case 'desktop':
      return 'Desktop'
    case 'web':
      return 'Web'
    default:
      return 'Unnamed'
  }
}

function windowName(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? 'second' : `${seconds}s`
  const minutes = seconds / 60
  return minutes === 1 ? 'minute' : `${minutes} min`
}

function outcomeLabel(key: string): string {
  const labels: Record<string, string> = {
    ok: 'OK',
    not_found: '404',
    throttled: '429',
    server_error: '5xx',
    client_error: '4xx',
    key_rejected: 'Key refused',
    network: 'No answer',
    canceled: 'Cancelled'
  }
  return labels[key] ?? key
}

function outcomeColour(key: string): string {
  switch (key) {
    case 'ok':
      return COLOUR.teal
    case 'not_found':
      return COLOUR.dim
    case 'throttled':
      return COLOUR.amber
    default:
      return COLOUR.red
  }
}

function syncTone(outcome: string): Tone {
  if (outcome === 'ok') return 'good'
  if (outcome === 'partial') return 'warn'
  return 'bad'
}

function syncOutcome(outcome: string): string {
  if (outcome === 'ok') return 'Complete'
  if (outcome === 'partial') return 'Left gaps'
  return 'Failed'
}
