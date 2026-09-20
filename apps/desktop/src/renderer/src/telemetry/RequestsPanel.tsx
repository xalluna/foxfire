import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { TelemetryOutcome, TelemetryRequest } from '@shared/telemetry'
import {
  TONE_CHIP,
  TONE_CLASS,
  formatBytes,
  formatClock,
  formatMs,
  outcomeTone,
  shortEndpoint
} from './format'

/**
 * Every Riot API attempt, newest first.
 *
 * The column that matters most is the wait/network split. The rate limiter
 * dispatches serially, so a slow backfill is either Riot being slow (network)
 * or the app's own queue holding requests back (wait) — and those call for
 * completely different responses. Nothing else in the app can tell them apart.
 */

const OUTCOMES: TelemetryOutcome[] = [
  'ok',
  'http_error',
  'parse_error',
  'network_error',
  'key_invalid',
  'never_ran'
]

export function RequestsPanel({ windowMs }: { windowMs: number }): JSX.Element {
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<TelemetryOutcome | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  const requests = useQuery({
    queryKey: ['telemetry', 'requests', windowMs, endpoint, outcome],
    queryFn: () => window.api.telemetry.requests({ windowMs, endpoint, outcome, limit: 300 }),
    refetchInterval: 1_000
  })

  // Aggregation scans far more rows than the table does, so it refreshes at a
  // fifth of the rate. Counters do not need to be frame-accurate.
  const summary = useQuery({
    queryKey: ['telemetry', 'summary', windowMs],
    queryFn: () => window.api.telemetry.summary(windowMs),
    refetchInterval: 5_000
  })

  const endpoints = useQuery({
    queryKey: ['telemetry', 'endpoints', windowMs],
    queryFn: () => window.api.telemetry.endpoints(windowMs),
    refetchInterval: 30_000
  })

  const rows = requests.data ?? []
  const stats = summary.data

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label="Requests" value={stats.logicalRequests.toLocaleString()} />
          <Metric
            label="Attempts"
            value={stats.attempts.toLocaleString()}
            hint={
              stats.attempts > stats.logicalRequests
                ? `${stats.attempts - stats.logicalRequests} retried`
                : undefined
            }
          />
          <Metric label="Errors" value={stats.errors.toLocaleString()} tone={stats.errors > 0 ? 'error' : 'ok'} />
          <Metric
            label="Throttled"
            value={stats.throttled.toLocaleString()}
            tone={stats.throttled > 0 ? 'warn' : 'ok'}
          />
          <Metric label="Wait p95" value={formatMs(stats.waitP95)} />
          <Metric label="Net p95" value={formatMs(stats.netP95)} />
          <Metric label="Transferred" value={formatBytes(stats.bytes)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={endpoint ?? ''}
          onChange={(value) => setEndpoint(value || null)}
          options={[
            { value: '', label: 'All endpoints' },
            ...(endpoints.data ?? []).map((e) => ({ value: e, label: shortEndpoint(e) }))
          ]}
        />
        <Select
          value={outcome ?? ''}
          onChange={(value) => setOutcome((value || null) as TelemetryOutcome | null)}
          options={[
            { value: '', label: 'All outcomes' },
            ...OUTCOMES.map((o) => ({ value: o, label: o }))
          ]}
        />
        <span className="ml-auto text-2xs text-text-mute">
          {rows.length === 0 ? 'No requests in window' : `${rows.length} shown, newest first`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-2xs uppercase tracking-widest text-text-mute">
              <Th className="w-24 text-left">Time</Th>
              <Th className="text-left">Endpoint</Th>
              <Th className="w-16 text-right">Status</Th>
              <Th className="w-20 text-right">Wait</Th>
              <Th className="w-20 text-right">Network</Th>
              <Th className="w-16 text-right">Try</Th>
              <Th className="w-20 text-right">Size</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                expanded={expanded === row.id}
                onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
              />
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="p-8 text-center text-sm text-text-mute">
            Nothing recorded in this window. Sync an account or check a live game to generate
            traffic.
          </p>
        )}
      </div>
    </div>
  )
}

function Row({
  row,
  expanded,
  onToggle
}: {
  row: TelemetryRequest
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  const tone = outcomeTone(row.outcome, row.status)

  return (
    <>
      <tr
        onClick={onToggle}
        className={clsx(
          'cursor-pointer border-b border-hairline/50 transition hover:bg-canvas',
          expanded && 'bg-canvas'
        )}
      >
        <Td className="font-mono text-2xs text-text-mute">{formatClock(row.startedAt)}</Td>
        <Td className="truncate text-text-dim" title={row.endpoint}>
          {shortEndpoint(row.endpoint)}
        </Td>
        <Td className={clsx('text-right font-mono', TONE_CLASS[tone])}>
          {row.status ?? row.outcome.replace('_', ' ')}
        </Td>
        <Td
          className={clsx(
            'text-right font-mono',
            // Anything over a second of queue wait is the limiter, not Riot.
            row.waitMs > 1_000 ? 'text-amber' : 'text-text-dim'
          )}
        >
          {formatMs(row.waitMs)}
        </Td>
        <Td className="text-right font-mono text-text-dim">{formatMs(row.networkMs)}</Td>
        <Td className={clsx('text-right font-mono', row.attempt > 1 ? 'text-amber' : 'text-text-mute')}>
          {row.attempt}
        </Td>
        <Td className="text-right font-mono text-text-mute">{formatBytes(row.bytes)}</Td>
      </tr>

      {expanded && (
        <tr className="border-b border-hairline bg-canvas">
          <td colSpan={7} className="px-3 py-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-2xs lg:grid-cols-3">
              <Detail label="Endpoint" value={row.endpoint} mono />
              <Detail label="Host" value={row.host} mono />
              <Detail label="Outcome" value={row.outcome} />
              <Detail label="Path hash" value={row.pathHash} mono />
              <Detail label="Request" value={row.requestId} mono />
              <Detail label="Span" value={row.spanId ?? '—'} mono />
              <Detail label="Scheduled" value={formatClock(row.scheduledAt)} mono />
              <Detail label="App limit" value={row.appLimit ?? '—'} mono />
              <Detail label="App count" value={row.appLimitCount ?? '—'} mono />
              <Detail label="Method limit" value={row.methodLimit ?? '—'} mono />
              <Detail label="Method count" value={row.methodLimitCount ?? '—'} mono />
              <Detail
                label="Retry after"
                value={row.retryAfterMs === null ? '—' : formatMs(row.retryAfterMs)}
                mono
              />
            </dl>

            {row.errorMessage && (
              <p
                className={clsx(
                  'mt-3 rounded-md border px-3 py-2 font-mono text-2xs',
                  TONE_CHIP[outcomeTone(row.outcome, row.status)]
                )}
              >
                {row.errorKind}: {row.errorMessage}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Metric({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: string
  hint?: string
  tone?: 'ok' | 'warn' | 'error'
}): JSX.Element {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-3 py-2">
      <div className="text-2xs font-medium uppercase tracking-widest text-text-mute">{label}</div>
      <div
        className={clsx(
          'mt-1 font-mono text-base',
          tone === 'error' ? 'text-red' : tone === 'warn' ? 'text-amber' : 'text-text'
        )}
      >
        {value}
      </div>
      {hint && <div className="text-2xs text-text-mute">{hint}</div>}
    </div>
  )
}

function Detail({
  label,
  value,
  mono
}: {
  label: string
  value: string
  mono?: boolean
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="uppercase tracking-widest text-text-mute">{label}</dt>
      <dd className={clsx('truncate text-text-dim', mono && 'font-mono')} title={value}>
        {value}
      </dd>
    </div>
  )
}

function Select({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-hairline bg-canvas px-2 py-1 text-2xs text-text-dim outline-none focus:border-accent-dim"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function Th({ className, children }: { className?: string; children: React.ReactNode }): JSX.Element {
  return <th className={clsx('px-3 py-2 font-medium', className)}>{children}</th>
}

function Td({
  className,
  title,
  children
}: {
  className?: string
  title?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <td className={clsx('max-w-0 px-3 py-1.5', className)} title={title}>
      {children}
    </td>
  )
}
