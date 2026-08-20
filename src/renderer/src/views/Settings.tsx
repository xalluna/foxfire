import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Disclaimer } from '../components/Disclaimer'
import { CaptureSettings } from '../components/CaptureSettings'
import { ReplaySettings } from '../components/ReplaySettings'
import { RankTrackingSettings } from '../components/RankTrackingSettings'
import { SeasonSettings } from '../components/SeasonSettings'
import { SectionSummary, SettingsSection } from '../components/SettingsSection'
import { TelemetrySettings } from '../components/TelemetrySettings'
import * as Icon from '../components/icons'
import { Logo } from '../components/Logo'
import type { IdentityReport, RiotKeyLimits, RiotKeyType } from '@shared/types'

// Only ever shown before the first settings load answers; the main process owns
// the real defaults (rateLimiter's APPLICATION_KEY_LIMITS).
const DEFAULT_APPLICATION_LIMITS: RiotKeyLimits = { burstLimit: 500, sustainedLimit: 30_000 }

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

  const setKeyType = useMutation({
    mutationFn: ({ keyType, limits }: { keyType: RiotKeyType; limits?: RiotKeyLimits }) =>
      window.api.settings.setKeyType(keyType, limits),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] })
  })

  const hasKey = settings.data?.hasApiKey ?? false
  const keyType = settings.data?.keyType ?? 'personal'
  const expires = keyType === 'personal'
  const relink = relinkSummary(save.data?.identities)

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
        blurb={
          expires
            ? 'Stored encrypted on this machine. Personal keys expire every 24 hours.'
            : 'Stored encrypted on this machine.'
        }
      >

        <p className="mt-2 text-sm leading-relaxed text-text-dim">
          {expires ? (
            <>
              Stored encrypted on this machine only. Personal development keys expire every 24 hours
              — when lookups start failing, paste a fresh one from the Riot developer portal.
            </>
          ) : (
            <>
              Stored encrypted on this machine only. Replacing it re-links every tracked account:
              Riot encrypts player IDs against the key that asked for them, so a new key needs new
              ones. Your match history comes across with them.
            </>
          )}
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
          <>
            <p className="mt-3 text-sm text-teal">Key verified against Riot and saved.</p>
            {relink.note && <p className="mt-1 text-sm text-text-dim">{relink.note}</p>}
            {relink.warning && <p className="mt-1 text-sm text-red">{relink.warning}</p>}
          </>
        )}

        <KeyTypeControl
          keyType={keyType}
          limits={settings.data?.applicationLimits ?? DEFAULT_APPLICATION_LIMITS}
          disabled={setKeyType.isPending}
          onChange={(next, limits) => setKeyType.mutate({ keyType: next, limits })}
        />

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

      <ReplaySettings />

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

/**
 * What saving a key did to the accounts.
 *
 * Worth saying out loud rather than leaving to be discovered: a new key sends
 * every account through a re-link that rewrites stored history onto new player
 * IDs, and an account that could not be re-linked — renamed, or unreachable —
 * is the one case that needs the user rather than the next sync.
 */
function relinkSummary(identities?: IdentityReport[]): { note?: string; warning?: string } {
  if (!identities?.length) return {}

  const repaired = identities.filter((report) => report.outcome === 'repaired')
  const stuck = identities.filter(
    (report) => report.outcome === 'unresolved' || report.outcome === 'failed'
  )

  return {
    note: repaired.length
      ? `Re-linked ${repaired.length} account${repaired.length === 1 ? '' : 's'} to the new key — match history kept.`
      : undefined,
    warning: stuck.length
      ? `Could not re-link ${stuck.map((report) => report.riotId).join(', ')}. If the Riot ID changed, remove the account and add it again under the new one.`
      : undefined
  }
}

/**
 * Which key is saved, and what it is allowed to do.
 *
 * The limits are editable for application keys because Riot grants them per
 * product — the defaults here are the usual pair, not a promise — and pacing
 * above what was actually granted turns every backfill into a run of 429s.
 * Personal limits are Riot's own fixed numbers and are shown rather than
 * offered.
 */
function KeyTypeControl({
  keyType,
  limits,
  disabled,
  onChange
}: {
  keyType: RiotKeyType
  limits: RiotKeyLimits
  disabled: boolean
  onChange: (keyType: RiotKeyType, limits?: RiotKeyLimits) => void
}): JSX.Element {
  // Local, so typing a number is not fought by the refetch each commit causes.
  // Tracked by value rather than by the object, which is rebuilt every render.
  const { burstLimit, sustainedLimit } = limits
  const [draft, setDraft] = useState<RiotKeyLimits>({ burstLimit, sustainedLimit })
  useEffect(() => setDraft({ burstLimit, sustainedLimit }), [burstLimit, sustainedLimit])

  const commit = (next: RiotKeyLimits): void => {
    setDraft(next)
    if (next.burstLimit > 0 && next.sustainedLimit > 0) onChange('application', next)
  }

  return (
    <div className="mt-4 rounded-md border border-hairline bg-canvas p-3">
      <span className="block text-sm text-text">Key type</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
        How fast this app is allowed to call Riot. A personal key is paced at Riot&apos;s fixed
        20/second and 100/2 minutes; an approved application key is paced at whatever it was granted.
      </span>

      <div className="mt-2 flex flex-wrap gap-4">
        {(['personal', 'application'] as const).map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="riot-key-type"
              disabled={disabled}
              checked={keyType === option}
              onChange={() => onChange(option, option === 'application' ? draft : undefined)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-text-dim">
              {option === 'personal' ? 'Personal (expires every 24h)' : 'Application'}
            </span>
          </label>
        ))}
      </div>

      {keyType === 'application' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-2xs uppercase tracking-widest text-text-mute">
              Requests per 10 seconds
            </span>
            <input
              type="number"
              min={1}
              disabled={disabled}
              value={draft.burstLimit}
              onChange={(event) => setDraft({ ...draft, burstLimit: Number(event.target.value) })}
              onBlur={() => commit(draft)}
              className="mt-1 w-28 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm tabular-nums text-text focus:border-accent-dim focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-2xs uppercase tracking-widest text-text-mute">
              Requests per 10 minutes
            </span>
            <input
              type="number"
              min={1}
              disabled={disabled}
              value={draft.sustainedLimit}
              onChange={(event) =>
                setDraft({ ...draft, sustainedLimit: Number(event.target.value) })
              }
              onBlur={() => commit(draft)}
              className="mt-1 w-28 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm tabular-nums text-text focus:border-accent-dim focus:outline-none"
            />
          </label>
        </div>
      )}
    </div>
  )
}
