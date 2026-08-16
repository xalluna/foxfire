import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChartCard, TimeSeriesChart, type Series } from './TimeSeriesChart'
import { formatClock, formatMs } from './format'

/**
 * Manual triggers for the two halves of the post-game path.
 *
 * Both normally fire only when a real game ends and Riot gets round to
 * publishing it — minutes of waiting on something that cannot be arranged on
 * demand. Kept here rather than in Settings because this window is already the
 * developer surface and neither button means anything to a normal user.
 */
function PostGameTools(): JSX.Element {
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(label: string, action: () => Promise<string>): Promise<void> {
    setBusy(true)
    setResult(`${label}…`)
    try {
      setResult(await action())
    } catch (err) {
      setResult(`${label} failed: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ChartCard title="Post-game path" hint="developer triggers">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <button
          disabled={busy}
          onClick={() =>
            run('Replaying attribution', async () => {
              const n = await window.api.telemetry.replayAttribution()
              return `Attributed LP to ${n} game${n === 1 ? '' : 's'}.`
            })
          }
          className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-2xs text-text-dim transition hover:border-gold-dim hover:text-gold disabled:opacity-50"
        >
          Replay LP attribution
        </button>

        <button
          disabled={busy}
          onClick={() =>
            run('Scheduling post-game sync', async () => {
              const ok = await window.api.telemetry.simulateGameEnd()
              return ok
                ? 'Scheduled — attempts run on the usual backoff; watch the log.'
                : 'No account to sync.'
            })
          }
          className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-2xs text-text-dim transition hover:border-gold-dim hover:text-gold disabled:opacity-50"
        >
          Simulate game end
        </button>

        {result && <span className="text-2xs text-text-mute">{result}</span>}
      </div>
    </ChartCard>
  )
}

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

      <PostGameTools />

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
