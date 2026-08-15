import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChartCard, TimeSeriesChart, type Series } from './TimeSeriesChart'
import { formatClock, formatMs } from './format'

/**
 * League client connection.
 *
 * Successful polls are sampled at most once a minute — the watcher runs one
 * every ten seconds forever, and recording all of them would bury everything
 * else. Transitions and errors are kept in full, which is the point: watcher.ts
 * swallows its errors deliberately, so until now a client that kept refusing
 * connections looked exactly like a client that was simply closed.
 */
export function LcuPanel({ windowMs }: { windowMs: number }): JSX.Element {
  const data = useQuery({
    queryKey: ['telemetry', 'lcu', windowMs],
    queryFn: () => window.api.telemetry.lcu(windowMs),
    refetchInterval: 5_000
  })

  const status = useQuery({
    queryKey: ['telemetry', 'lcuStatus'],
    queryFn: () => window.api.lcu.getStatus(),
    refetchInterval: 5_000
  })

  const latency = data.data?.latency ?? []
  const recent = data.data?.recent ?? []
  const state = status.data?.state ?? 'disconnected'

  const series: Series[] = [
    {
      label: 'Poll latency',
      colour: 'rgb(var(--teal))',
      points: latency.map((p) => ({ at: p.at, value: p.ms })),
      fill: true
    }
  ]

  return (
    <div className="space-y-4">
      <div
        className={clsx(
          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
          state === 'connected'
            ? 'border-teal/30 bg-teal/10 text-teal'
            : state === 'untracked'
              ? 'border-amber/40 bg-amber/10 text-amber'
              : 'border-hairline bg-surface text-text-mute'
        )}
      >
        <span className="font-mono text-2xs uppercase tracking-widest">{state}</span>
        <span className="text-2xs opacity-80">
          {latency.length > 0
            ? `last sampled poll ${formatMs(latency[latency.length - 1].ms)}`
            : 'no polls sampled in this window'}
        </span>
      </div>

      <ChartCard title="Poll latency" hint="loopback, sampled once a minute">
        <TimeSeriesChart
          series={series}
          formatValue={(v) => formatMs(v)}
          ariaLabel="League client poll latency over time"
        />
      </ChartCard>

      <ChartCard title="Connection events" hint="transitions and errors, never successful polls">
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-mute">
            Nothing recorded in this window.
          </p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {recent.map((event, i) => (
              <li key={`${event.at}-${i}`} className="flex items-baseline gap-3 py-1.5 text-2xs">
                <span className="font-mono text-text-mute">{formatClock(event.at)}</span>
                <span
                  className={clsx(
                    'w-24 shrink-0 font-mono uppercase tracking-widest',
                    event.kind === 'error'
                      ? 'text-red'
                      : event.kind === 'connected'
                        ? 'text-teal'
                        : 'text-text-mute'
                  )}
                >
                  {event.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-dim" title={event.detail ?? ''}>
                  {event.detail ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
    </div>
  )
}
