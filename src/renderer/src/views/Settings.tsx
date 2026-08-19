import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Disclaimer } from '../components/Disclaimer'
import { CaptureSettings } from '../components/CaptureSettings'
import { RankTrackingSettings } from '../components/RankTrackingSettings'
import { SeasonSettings } from '../components/SeasonSettings'
import { SectionSummary, SettingsSection } from '../components/SettingsSection'
import { TelemetrySettings } from '../components/TelemetrySettings'
import * as Icon from '../components/icons'
import { Logo } from '../components/Logo'

export function Settings(): JSX.Element {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get()
  })

  // Fixed for the life of the process, so it never needs refetching.
  const version = useQuery({
    queryKey: ['appVersion'],
    queryFn: () => window.api.app.getVersion(),
    staleTime: Infinity
  })

  const save = useMutation({
    mutationFn: (value: string) => window.api.settings.setApiKey(value),
    onSuccess: (result) => {
      if (result.ok) {
        setKey('')
        setError(null)
        queryClient.invalidateQueries({ queryKey: ['settings'] })
      } else {
        setError(result.message ?? 'Could not save key')
      }
    }
  })

  const clear = useMutation({
    mutationFn: () => window.api.settings.clearApiKey(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] })
  })

  const hasKey = settings.data?.hasApiKey ?? false

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <h1 className="font-display text-xl text-text">Settings</h1>

      <SettingsSection
        icon={<Icon.Key className="shrink-0 text-accent" />}
        title="Riot API key"
        // Flagged rather than opened when missing: nothing else in the app
        // works without it, and a fold that quietly hides that is a trap.
        summary={
          hasKey ? (
            <SectionSummary tone="good">Saved</SectionSummary>
          ) : (
            <SectionSummary tone="warn">Not set</SectionSummary>
          )
        }
        blurb="Stored encrypted on this machine. Personal keys expire every 24 hours."
      >

        <p className="mt-2 text-sm leading-relaxed text-text-dim">
          Stored encrypted on this machine only. Personal development keys expire every 24 hours —
          when lookups start failing, paste a fresh one from the Riot developer portal.
        </p>

        <div
          className={clsx(
            'mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
            hasKey
              ? 'border-teal/30 bg-teal/10 text-teal'
              : 'border-hairline bg-canvas text-text-mute'
          )}
        >
          {hasKey ? <Icon.Check width={14} height={14} /> : <Icon.Warning width={14} height={14} />}
          {hasKey ? 'A key is saved and verified' : 'No key saved yet'}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            save.mutate(key)
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="RGAPI-..."
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-sm text-text outline-none transition placeholder:text-text-mute focus:border-accent-dim"
          />
          <button
            type="submit"
            disabled={!key.trim() || save.isPending}
            className="rounded-md border border-accent-dim bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
          >
            {save.isPending ? 'Checking…' : 'Save'}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-red">{error}</p>}
        {save.isSuccess && save.data.ok && !error && (
          <p className="mt-3 text-sm text-teal">Key verified against Riot and saved.</p>
        )}

        {hasKey && (
          <button
            onClick={() => clear.mutate()}
            className="mt-4 text-sm text-text-mute underline underline-offset-2 transition hover:text-red"
          >
            Remove saved key
          </button>
        )}
      </SettingsSection>

      <RankTrackingSettings />

      <SeasonSettings />

      <CaptureSettings />

      <TelemetrySettings />

      <SettingsSection
        title="About"
        summary={version.data && <SectionSummary>Version {version.data}</SectionSummary>}
        blurb="What this is, and the Riot disclaimer."
      >
        <div className="mt-2 flex items-start gap-3">
          <Logo width={28} height={28} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-sm leading-relaxed text-text-dim">
            Foxfire is a personal League of Legends stats tracker. Match history is stored locally
            in SQLite and served from disk — the Riot API is only called when syncing.
          </p>
        </div>
        <div className="mt-4 border-t border-hairline pt-4">
          <Disclaimer />
        </div>
      </SettingsSection>
    </div>
  )
}
