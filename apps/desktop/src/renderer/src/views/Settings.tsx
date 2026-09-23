import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import {
  DangerRow,
  Disclaimer,
  Icon,
  Logo,
  SettingsBlock,
  SettingsCard,
  SettingsNav,
  SettingsPage,
  SettingsRow,
  StatusRow,
  checkboxClass,
  inputClass,
  primaryButtonClass,
  type SettingsNavItem
} from '@foxfire/ui'
import {
  InvitesScreen,
  LeagueAccountsScreen,
  MembersScreen,
  ServerDataScreen,
  useIsServerAdmin
} from '@foxfire/screens'
import { CaptureSettings } from '../components/CaptureSettings'
import { ServerSettings } from '../components/ServerSettings'
import { useServerHealth } from '../hooks/useKeyStatus'
import { ReplaySettings } from '../components/ReplaySettings'
import { RankTrackingSettings } from '../components/RankTrackingSettings'
import { TelemetrySettings } from '../components/TelemetrySettings'
import { UpdateSettings } from '../components/UpdateSettings'
import type { IdentityReport, RiotKeyLimits, RiotKeyType } from '@shared/types'

/**
 * Which settings page is on screen.
 *
 * Ranked seasons is not one of these. It was its own top-level section when
 * every section was a fold, but it exists to serve rank history — the dates
 * decide which games belong to which season — so it is now a card on the Rank
 * tracking page rather than a sibling of it.
 */
export type SettingsCategory =
  | 'server'
  | 'server-members'
  | 'server-invites'
  | 'server-accounts'
  | 'server-data'
  | 'riot-key'
  | 'rank'
  | 'capture'
  | 'replays'
  | 'telemetry'
  | 'about'

/**
 * Where Settings opens when nothing says otherwise.
 *
 * The Riot key rather than Server, because the key is what the app cannot work
 * without. Server sits above it in the sidebar — it is the bigger decision, and
 * it decides whether the key page applies at all — but it is not where somebody
 * with a problem needs to arrive. Connected to a server there is no key page,
 * and Settings opens on Server instead.
 */
const FIRST_CATEGORY: SettingsCategory = 'riot-key'

interface NavItem extends SettingsNavItem<SettingsCategory> {
  /** Shown only to an administrator of the server currently connected. */
  adminOnly?: boolean
  /**
   * Hidden while a server is answering.
   *
   * For the one page that is genuinely about nothing then: connected, this
   * machine holds no Riot key at all — the server has one, shared by everybody
   * on it — so a page offering to save one would be offering to save something
   * nothing would read.
   */
  localOnly?: boolean
}

/**
 * The sidebar, in groups.
 *
 * Grouped the way the app is: where its data comes from, what it records off
 * your machine, and the two pages that are about Foxfire itself rather than
 * about League.
 */
const GROUPS: NavItem[][] = [
  [
    { id: 'server', label: 'Server', icon: <Icon.Server /> },
    { id: 'server-members', label: 'Members', icon: <Icon.Settings />, adminOnly: true },
    { id: 'server-invites', label: 'Invites', icon: <Icon.Link />, adminOnly: true },
    { id: 'server-accounts', label: 'League accounts', icon: <Icon.Server />, adminOnly: true },
    { id: 'server-data', label: 'Data & storage', icon: <Icon.Inbox />, adminOnly: true },
    { id: 'riot-key', label: 'Riot API key', icon: <Icon.Key />, localOnly: true },
    { id: 'rank', label: 'Rank tracking', icon: <Icon.TrendingUp /> }
  ],
  [
    { id: 'capture', label: 'Game capture', icon: <Icon.Film /> },
    { id: 'replays', label: 'Riot replays', icon: <Icon.Replay /> }
  ],
  [
    { id: 'telemetry', label: 'Developer telemetry', icon: <Icon.Activity /> },
    { id: 'about', label: 'About', icon: <Icon.Info /> }
  ]
]

// Only ever shown before the first settings load answers; the main process owns
// the real defaults (rateLimiter's APPLICATION_KEY_LIMITS).
const DEFAULT_APPLICATION_LIMITS: RiotKeyLimits = { burstLimit: 500, sustainedLimit: 30_000 }

/**
 * Settings, as a sidebar and one page at a time.
 *
 * This used to be seven folded cards in a single column, because all seven open
 * at once are far longer than a window. A sidebar answers that better than a
 * fold did: the list of what exists is permanent and on screen, so a page can
 * be as long as it needs to be without hiding anything, and no section has to
 * summarise itself beside a chevron to stay honest about its own state.
 *
 * Which page is open is the URL's — `/settings/rank` — so the key banners and
 * the rank page's League-client line can each send somebody straight to the
 * page they mean. A category that is not on offer to this person right now
 * shows the opening page instead, without rewriting the address: an admin page
 * a moment before the connection has said who is an admin should appear once
 * it has, rather than having been redirected away from for good.
 */
export function Settings({ category }: { category?: string }): JSX.Element {
  const navigate = useNavigate()

  // Drives whether the management pages are offered at all. Follows every
  // connection change, so signing out of a server takes its admin pages with it
  // rather than leaving a page whose every call now fails.
  //
  // Decides what to draw and nothing else. The server checks the role on every
  // request it serves, so a window belonging to somebody demoted a minute ago
  // shows a page whose every call is refused — which is the right way round.
  const isServerAdmin = useIsServerAdmin()
  const { connected: isConnected } = useServerHealth()

  const groups = GROUPS.map((group) =>
    group.filter((item) => (!item.adminOnly || isServerAdmin) && (!item.localOnly || !isConnected))
  )

  const opening: SettingsCategory = isConnected ? 'server' : FIRST_CATEGORY
  const active = groups.flat().find((item) => item.id === category)?.id ?? opening

  const pane = useRef<HTMLDivElement>(null)

  // Arriving at a page scrolled to where the last one was left is disorienting
  // when the pages are unrelated.
  useEffect(() => {
    pane.current?.scrollTo({ top: 0 })
  }, [active])

  return (
    <div className="flex h-full min-h-0">
      <SettingsNav
        groups={groups}
        active={active}
        onSelect={(id) => void navigate({ to: '/settings/{-$category}', params: { category: id } })}
      />

      <div ref={pane} className="min-w-0 flex-1 overflow-y-auto">
        {active === 'server' && <ServerSettings />}
        {active === 'server-members' && <MembersScreen />}
        {active === 'server-invites' && <InvitesScreen />}
        {active === 'server-accounts' && <LeagueAccountsScreen />}
        {active === 'server-data' && <ServerDataScreen />}
        {active === 'riot-key' && <RiotKeySettings />}
        {active === 'rank' && <RankTrackingSettings />}
        {active === 'capture' && <CaptureSettings />}
        {active === 'replays' && <ReplaySettings />}
        {active === 'telemetry' && <TelemetrySettings />}
        {active === 'about' && <AboutSettings />}
      </div>
    </div>
  )
}

function RiotKeySettings(): JSX.Element {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get()
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
    <SettingsPage
      title="Riot API key"
      intro={
        expires ? (
          <>
            Stored encrypted on this machine only. Personal development keys expire every 24 hours —
            when lookups start failing, paste a fresh one from the Riot developer portal.
          </>
        ) : (
          <>
            Stored encrypted on this machine only. Replacing it re-links every tracked account: Riot
            encrypts player IDs against the key that asked for them, so a new key needs new ones.
            Your match history comes across with them.
          </>
        )
      }
    >
      <SettingsCard>
        <StatusRow tone={hasKey ? 'good' : 'warn'}>
          {hasKey ? 'A key is saved and verified' : 'No key saved yet'}
        </StatusRow>

        <SettingsBlock label="Paste a key">
          <form
            className="flex gap-2"
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
              aria-label="Riot API key"
              autoComplete="off"
              spellCheck={false}
              className={clsx(inputClass, 'flex-1 font-mono')}
            />
            <button
              type="submit"
              disabled={!key.trim() || save.isPending}
              className={primaryButtonClass}
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
        </SettingsBlock>

        <KeyTypeControl
          keyType={keyType}
          limits={settings.data?.applicationLimits ?? DEFAULT_APPLICATION_LIMITS}
          disabled={setKeyType.isPending}
          onChange={(next, limits) => setKeyType.mutate({ keyType: next, limits })}
        />

        {hasKey && (
          <DangerRow
            label="Remove saved key"
            description="Deletes it from this machine. Nothing already synced is lost, but no further lookups will work until a key is saved again."
            action="Remove"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          />
        )}
      </SettingsCard>
    </SettingsPage>
  )
}

function AboutSettings(): JSX.Element {
  // Fixed for the life of the process, so it never needs refetching.
  const version = useQuery({
    queryKey: ['appVersion'],
    queryFn: () => window.api.app.getVersion(),
    staleTime: Infinity
  })

  return (
    <SettingsPage title="About">
      <SettingsCard>
        <SettingsBlock>
          <div className="flex items-start gap-3">
            <Logo width={28} height={28} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-sm leading-relaxed text-text-dim">
              Foxfire is a personal League of Legends stats tracker. Match history is stored locally
              in SQLite and served from disk — the Riot API is only called when syncing.
            </p>
          </div>
        </SettingsBlock>

        <SettingsRow
          label="Version"
          control={<span className="text-sm tabular-nums text-text-dim">{version.data ?? '—'}</span>}
        />

        <UpdateSettings />

        <SettingsBlock>
          <Disclaimer />
        </SettingsBlock>
      </SettingsCard>
    </SettingsPage>
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
    <SettingsBlock
      label="Key type"
      description="How fast this app is allowed to call Riot. A personal key is paced at Riot's fixed 20/second and 100/2 minutes; an approved application key is paced at whatever it was granted."
    >
      <div className="flex flex-wrap gap-4">
        {(['personal', 'application'] as const).map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="riot-key-type"
              disabled={disabled}
              checked={keyType === option}
              onChange={() => onChange(option, option === 'application' ? draft : undefined)}
              className={checkboxClass}
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
              className={clsx(inputClass, 'mt-1 w-28 tabular-nums')}
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
              className={clsx(inputClass, 'mt-1 w-28 tabular-nums')}
            />
          </label>
        </div>
      )}
    </SettingsBlock>
  )
}
