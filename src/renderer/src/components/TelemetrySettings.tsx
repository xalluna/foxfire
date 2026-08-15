import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TelemetryState } from '@shared/telemetry'
import { Toggle } from './Toggle'
import * as Icon from './icons'

/**
 * Switch for the developer telemetry subsystem.
 *
 * Off by default and always compiled in, so the interesting case is the
 * packaged app rather than `npm run dev`. Enabling takes effect immediately —
 * telemetry.db is created on first use, which is why a user who never turns
 * this on never gets the file at all.
 */
export function TelemetrySettings(): JSX.Element {
  const queryClient = useQueryClient()

  const state = useQuery({
    queryKey: ['telemetry', 'state'],
    queryFn: () => window.api.telemetry.getState(),
    // Enough to watch the buffer drain after a sync, without polling the main
    // process pointlessly while nothing is happening.
    refetchInterval: 5_000
  })

  const applyState = (next: TelemetryState): void => {
    queryClient.setQueryData(['telemetry', 'state'], next)
  }

  const update = useMutation({
    mutationFn: (enabled: boolean) => window.api.telemetry.setEnabled(enabled),
    onSuccess: applyState
  })

  const clear = useMutation({
    mutationFn: () => window.api.telemetry.clear(),
    onSuccess: applyState
  })

  const data = state.data
  const enabled = data?.enabled ?? false

  return (
    <section className="rounded-lg border border-hairline bg-surface p-5">
      <div className="flex items-center gap-2">
        <Icon.Activity className="text-gold" />
        <h2 className="font-display text-lg text-text">Developer telemetry</h2>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-text-dim">
        Records what the app is doing and consuming — every Riot API call with its queue wait and
        network time, rate-limit headroom, process CPU and memory, and the League client connection.
        Stored locally in its own database, kept for two days in full detail, and never sent
        anywhere.
      </p>

      <div className="mt-4 space-y-3">
        <Toggle
          label="Collect telemetry"
          description="Takes effect immediately. Adds a small amount of buffered background writing; turning it off keeps everything already collected."
          checked={enabled}
          disabled={update.isPending || !data}
          onChange={(next) => update.mutate(next)}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => window.api.telemetry.openWindow()}
          className="rounded-md border border-gold-dim bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold transition hover:bg-gold/20"
        >
          Open panel
        </button>
        <span className="text-2xs text-text-mute">or press Ctrl+Shift+T anywhere</span>
      </div>

      {data && (
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
          <Stat label="On disk" value={formatBytes(data.dbBytes)} />
          <Stat label="Buffered" value={data.pending.toLocaleString()} />
          <Stat
            label="Dropped"
            value={data.dropped.toLocaleString()}
            // A non-zero value means the panel has gaps that are not idleness.
            tone={data.dropped > 0 ? 'warn' : 'normal'}
          />
        </dl>
      )}

      {data && data.dbBytes !== null && (
        <button
          onClick={() => clear.mutate()}
          disabled={clear.isPending}
          className="mt-4 text-sm text-text-mute underline underline-offset-2 transition hover:text-red disabled:opacity-40"
        >
          {clear.isPending ? 'Clearing…' : 'Clear collected telemetry'}
        </button>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  tone = 'normal'
}: {
  label: string
  value: string
  tone?: 'normal' | 'warn'
}): JSX.Element {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-widest text-text-mute">{label}</dt>
      <dd
        className={
          tone === 'warn' ? 'mt-1 font-mono text-sm text-amber' : 'mt-1 font-mono text-sm text-text'
        }
      >
        {value}
      </dd>
    </div>
  )
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
