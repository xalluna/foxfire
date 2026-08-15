import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { TelemetryState } from '@shared/telemetry'
import { RequestsPanel } from './RequestsPanel'
import { RateLimitPanel } from './RateLimitPanel'
import { ResourcesPanel } from './ResourcesPanel'
import { LcuPanel } from './LcuPanel'
import { WINDOW_OPTIONS, formatBytes } from './format'
import * as Icon from '../components/icons'

const TABS = [
  { id: 'requests', label: 'Riot requests' },
  { id: 'rateLimit', label: 'Rate limit' },
  { id: 'resources', label: 'Resources' },
  { id: 'lcu', label: 'League client' }
] as const

type TabId = (typeof TABS)[number]['id']

/**
 * Root of the developer telemetry panel.
 *
 * Mounted in its own BrowserWindow rather than as a tab in the app, so the
 * renderer it measures is not the renderer drawing the charts. It loads the
 * same bundle as the main window and selects itself on a `#telemetry` hash —
 * see main.tsx — which avoids maintaining a second Vite entry point.
 */
export function TelemetryApp(): JSX.Element {
  const queryClient = useQueryClient()
  const [windowMs, setWindowMs] = useState<number>(WINDOW_OPTIONS[1].ms)
  const [tab, setTab] = useState<TabId>('requests')

  const state = useQuery({
    queryKey: ['telemetry', 'state'],
    queryFn: () => window.api.telemetry.getState(),
    refetchInterval: 2_000
  })

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => window.api.telemetry.setEnabled(enabled),
    onSuccess: (next: TelemetryState) => queryClient.setQueryData(['telemetry', 'state'], next)
  })

  const data = state.data

  return (
    <div className="min-h-screen bg-canvas text-text">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <Icon.Activity className="text-gold" />
          <h1 className="font-display text-base text-text">Telemetry</h1>

          {data && (
            <button
              onClick={() => setEnabled.mutate(!data.enabled)}
              disabled={setEnabled.isPending}
              className={clsx(
                'rounded-full border px-2.5 py-0.5 text-2xs font-medium transition',
                data.enabled
                  ? 'border-teal/30 bg-teal/10 text-teal hover:bg-teal/20'
                  : 'border-hairline bg-surface text-text-mute hover:border-gold-dim hover:text-gold'
              )}
            >
              {data.enabled ? 'Collecting' : 'Paused'}
            </button>
          )}

          <div className="ml-auto flex items-center gap-1">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.label}
                onClick={() => setWindowMs(option.ms)}
                className={clsx(
                  'rounded-md px-2 py-1 text-2xs font-medium transition',
                  windowMs === option.ms
                    ? 'bg-gold/15 text-gold'
                    : 'text-text-mute hover:bg-surface hover:text-text-dim'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <nav className="flex items-center gap-1 border-t border-hairline px-4">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              className={clsx(
                'border-b-2 px-3 py-2 text-2xs font-medium transition',
                tab === entry.id
                  ? 'border-gold text-gold'
                  : 'border-transparent text-text-mute hover:text-text-dim'
              )}
            >
              {entry.label}
            </button>
          ))}

          {data && (
            <div className="ml-auto flex items-center gap-4 py-1.5 text-2xs text-text-mute">
              <span className="font-mono">{formatBytes(data.dbBytes)} on disk</span>
              <span className="font-mono">{data.pending} buffered</span>
              {data.dropped > 0 && (
                <span className="font-mono text-amber">
                  {data.dropped.toLocaleString()} dropped — this view has gaps
                </span>
              )}
            </div>
          )}
        </nav>
      </header>

      <main className="p-5">
        {data && !data.enabled && data.dbBytes === null ? (
          <div className="mx-auto max-w-md rounded-lg border border-hairline bg-surface p-8 text-center">
            <Icon.Activity className="mx-auto text-text-mute" width={28} height={28} />
            <h2 className="mt-3 font-display text-lg text-text">Nothing collected yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-dim">
              Telemetry is off. Switch it on to start recording Riot API calls, rate-limit headroom
              and resource usage.
            </p>
            <button
              onClick={() => setEnabled.mutate(true)}
              disabled={setEnabled.isPending}
              className="mt-4 rounded-md border border-gold-dim bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition hover:bg-gold/20"
            >
              Start collecting
            </button>
          </div>
        ) : tab === 'requests' ? (
          <RequestsPanel windowMs={windowMs} />
        ) : tab === 'rateLimit' ? (
          <RateLimitPanel windowMs={windowMs} />
        ) : tab === 'resources' ? (
          <ResourcesPanel windowMs={windowMs} />
        ) : (
          <LcuPanel windowMs={windowMs} />
        )}
      </main>
    </div>
  )
}
