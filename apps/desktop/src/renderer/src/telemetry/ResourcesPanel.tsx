import { useQuery } from '@tanstack/react-query'
import { ChartCard, TimeSeriesChart, type Series } from '@foxfire/ui'
import { formatMs } from './format'

/**
 * Per-process CPU and memory, plus the event-loop delay of the main process.
 *
 * Event-loop delay is the chart worth looking at first. node:sqlite is
 * synchronous, so a slow write does not show up as CPU — it shows up as the
 * main thread not running anything for a while, which nothing else here can
 * see. The limiter's queue depth is drawn alongside it because the two move
 * together during a backfill.
 */

/** Electron's own process-type names, kept verbatim so they match its docs. */
const PROCESS_COLOURS: Record<string, string> = {
  Browser: 'rgb(var(--accent))',
  Tab: 'rgb(var(--teal))',
  GPU: 'rgb(var(--amber))',
  Utility: 'rgb(var(--text-dim))'
}

const PROCESS_LABELS: Record<string, string> = {
  Browser: 'Main',
  Tab: 'Renderer',
  GPU: 'GPU',
  Utility: 'Utility'
}

function colourFor(processType: string): string {
  return PROCESS_COLOURS[processType] ?? 'rgb(var(--text-mute))'
}

function labelFor(processType: string): string {
  return PROCESS_LABELS[processType] ?? processType
}

export function ResourcesPanel({ windowMs }: { windowMs: number }): JSX.Element {
  const data = useQuery({
    queryKey: ['telemetry', 'resources', windowMs],
    queryFn: () => window.api.telemetry.resources(windowMs),
    refetchInterval: 5_000
  })

  const series = data.data?.series ?? []
  const loopDelay = data.data?.loopDelay ?? []

  if (series.length === 0) {
    return (
      <div className="rounded-lg border border-hairline bg-surface p-8 text-center">
        <p className="text-sm text-text-mute">
          No samples yet. Sampling drops to once every ten seconds while the app is idle.
        </p>
      </div>
    )
  }

  const cpuSeries: Series[] = series.map((s) => ({
    label: labelFor(s.processType),
    colour: colourFor(s.processType),
    points: s.points.map((p) => ({ at: p.at, value: p.cpuPercent }))
  }))

  const memSeries: Series[] = series.map((s) => ({
    label: labelFor(s.processType),
    colour: colourFor(s.processType),
    points: s.points.map((p) => ({
      at: p.at,
      value: p.workingSetKb === null ? null : p.workingSetKb / 1024
    }))
  }))

  const loopSeries: Series[] = [
    {
      label: 'Loop delay p99',
      colour: 'rgb(var(--red))',
      points: loopDelay.map((p) => ({ at: p.at, value: p.p99Ms })),
      fill: true
    },
    {
      label: 'Loop delay mean',
      colour: 'rgb(var(--teal))',
      points: loopDelay.map((p) => ({ at: p.at, value: p.meanMs }))
    }
  ]

  const queueSeries: Series[] = [
    {
      label: 'Limiter queue depth',
      colour: 'rgb(var(--accent))',
      points: loopDelay.map((p) => ({ at: p.at, value: p.queueDepth })),
      fill: true,
      step: true
    }
  ]

  return (
    <div className="space-y-4">
      <ChartCard title="CPU" hint="percent of one core, per Electron process">
        <TimeSeriesChart
          series={cpuSeries}
          formatValue={(v) => `${v.toFixed(0)}%`}
          ariaLabel="CPU usage per process over time"
        />
      </ChartCard>

      <ChartCard title="Memory" hint="working set, per Electron process">
        <TimeSeriesChart
          series={memSeries}
          formatValue={(v) => `${v.toFixed(0)}MB`}
          ariaLabel="Memory usage per process over time"
        />
      </ChartCard>

      <ChartCard
        title="Event loop delay"
        hint="how long the main thread went without running — synchronous SQLite writes show up here, not in CPU"
      >
        <TimeSeriesChart
          series={loopSeries}
          formatValue={(v) => formatMs(v)}
          ariaLabel="Main process event loop delay over time"
        />
      </ChartCard>

      <ChartCard title="Rate limiter queue" hint="requests waiting for a dispatch slot">
        <TimeSeriesChart
          series={queueSeries}
          formatValue={(v) => String(Math.round(v))}
          ariaLabel="Rate limiter queue depth over time"
        />
      </ChartCard>
    </div>
  )
}
