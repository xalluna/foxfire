import { useQuery } from '@tanstack/react-query'
import type { RateLimitWindowSeries } from '@shared/telemetry'
import { ChartCard, TimeSeriesChart, type Series } from './TimeSeriesChart'

/**
 * Headroom against Riot's own counters.
 *
 * The app's limiter runs on hardcoded numbers — 20/s and 100/2min — and has
 * never read a rate-limit header in its life. These charts come from
 * X-App-Rate-Limit-Count, which is what Riot actually counted, so a line that
 * behaves differently from what the limiter assumed is the interesting result
 * rather than a bug in the chart.
 *
 * Nothing here feeds back into the limiter: this is observation only.
 */
export function RateLimitPanel({ windowMs }: { windowMs: number }): JSX.Element {
  const data = useQuery({
    queryKey: ['telemetry', 'rateLimit', windowMs],
    queryFn: () => window.api.telemetry.rateLimit(windowMs),
    refetchInterval: 5_000
  })

  const app = data.data?.app ?? []
  const method = data.data?.method ?? []
  const throttledAt = data.data?.throttledAt ?? []

  if (app.length === 0 && method.length === 0) {
    return (
      <div className="rounded-lg border border-hairline bg-surface p-8 text-center">
        <p className="text-sm text-text-mute">
          No rate-limit headers recorded yet. They arrive with the first Riot response.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {throttledAt.length > 0 && (
        <p className="rounded-md border border-red/40 bg-red/10 px-3 py-2 text-2xs text-red">
          {throttledAt.length} throttled {throttledAt.length === 1 ? 'response' : 'responses'} (429)
          in this window, marked on the charts below.
        </p>
      )}

      {app.map((series) => (
        <WindowChart
          key={`app-${series.windowSeconds}`}
          scope="App"
          series={series}
          markers={throttledAt}
        />
      ))}

      {method.map((series) => (
        <WindowChart
          key={`method-${series.windowSeconds}`}
          scope="Method"
          series={series}
          markers={throttledAt}
        />
      ))}
    </div>
  )
}

function WindowChart({
  scope,
  series,
  markers
}: {
  scope: string
  series: RateLimitWindowSeries
  markers: number[]
}): JSX.Element {
  const peak = Math.max(0, ...series.points.map((p) => p.count))
  const utilisation = series.limit > 0 ? Math.round((peak / series.limit) * 100) : 0

  const chartSeries: Series[] = [
    {
      label: `${scope} · ${series.windowSeconds}s window`,
      colour: utilisation >= 90 ? 'rgb(var(--red))' : 'rgb(var(--teal))',
      points: series.points.map((p) => ({ at: p.at, value: p.count })),
      fill: true,
      // Riot's counter holds its value between responses rather than sliding
      // continuously, so a stepped line is the honest shape.
      step: true
    }
  ]

  return (
    <ChartCard
      title={`${scope} limit — ${series.limit} per ${series.windowSeconds}s`}
      hint={`peaked at ${peak} (${utilisation}% of the ceiling)`}
    >
      <TimeSeriesChart
        series={chartSeries}
        yMax={series.limit > 0 ? series.limit * 1.1 : undefined}
        threshold={series.limit > 0 ? { value: series.limit, label: 'ceiling' } : undefined}
        markers={markers}
        formatValue={(v) => String(Math.round(v))}
        ariaLabel={`${scope} rate limit usage over ${series.windowSeconds} second window`}
      />
    </ChartCard>
  )
}
