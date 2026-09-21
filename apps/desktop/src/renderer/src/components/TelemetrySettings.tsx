import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TelemetryState } from '@shared/telemetry'
import { SettingsCard, SettingsPage, DangerRow, LinkRow, Stat, StatRow, ToggleRow } from '@foxfire/ui'

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
    <SettingsPage
      title="Developer telemetry"
      intro={
        <>
          Records what the app is doing and consuming — every Riot API call with its queue wait and
          network time, rate-limit headroom, process CPU and memory, and the League client
          connection. Stored locally in its own database, kept for two days in full detail, and never
          sent anywhere.
        </>
      }
    >
      <SettingsCard>
        <ToggleRow
          label="Collect telemetry"
          description="Takes effect immediately. Adds a small amount of buffered background writing; turning it off keeps everything already collected."
          checked={enabled}
          disabled={update.isPending || !data}
          onChange={(next) => update.mutate(next)}
        />

        <LinkRow
          label="Open panel"
          description="or press Ctrl+Shift+T anywhere"
          onClick={() => window.api.telemetry.openWindow()}
        />

        {data && (
          <StatRow>
            <Stat label="On disk" value={formatBytes(data.dbBytes)} />
            <Stat label="Buffered" value={data.pending.toLocaleString()} />
            <Stat
              label="Dropped"
              value={data.dropped.toLocaleString()}
              // A non-zero value means the panel has gaps that are not idleness.
              tone={data.dropped > 0 ? 'warn' : 'normal'}
            />
          </StatRow>
        )}

        {data && data.dbBytes !== null && (
          <DangerRow
            label="Clear collected telemetry"
            action={clear.isPending ? 'Clearing…' : 'Clear'}
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          />
        )}
      </SettingsCard>
    </SettingsPage>
  )
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
