import { useState } from 'react'
import clsx from 'clsx'
import type {
  AdminActionResult,
  EmailKind,
  EmailLogEntry,
  EmailOverview,
  EmailQuotaWindow,
  EmailStatus,
  EmailSuppression
} from '@foxfire/core'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass, primaryButtonClass, selectClass } from '../components/settings/controls'
import { EmptyState } from '../components/EmptyState'
import { ShowMoreButton } from '../components/ShowMore'
import * as Icon from '../components/icons'
import { formatWhen, heldReason, statusLabel, statusTone } from './mailStatus'

/** What the log is narrowed to. */
export interface EmailLogFilters {
  kind: EmailKind | ''
  status: EmailStatus | 'pending' | ''
  q: string
}

export interface EmailAdminPageProps {
  /** Undefined while it loads; null from a server too old to send mail. */
  overview: EmailOverview | null | undefined
  overviewError?: string | null

  /** The pages of the log fetched so far, newest first. Undefined while the first loads. */
  log: EmailLogEntry[] | undefined
  logTotal: number | undefined
  filters: EmailLogFilters
  onFilters: (filters: EmailLogFilters) => void
  hasMoreLog: boolean
  loadingMoreLog: boolean
  onShowMoreLog: () => void

  suppressions: EmailSuppression[] | undefined
  suppressionsTotal: number | undefined
  hasMoreSuppressions: boolean
  loadingMoreSuppressions: boolean
  onShowMoreSuppressions: () => void
  onClearSuppression: (id: string) => Promise<AdminActionResult>

  onSendTest: (to: string) => Promise<AdminActionResult>
  /** Pre-filled in the test form: the head admin's own address. */
  defaultTestAddress?: string
}

const KINDS: Array<[EmailKind, string]> = [
  ['invite', 'Invites'],
  ['password_reset', 'Password resets'],
  ['verification', 'Confirmations'],
  ['email_change', 'Email changes'],
  ['password_changed', 'Password changed'],
  ['test', 'Tests']
]

const STATUSES: Array<[EmailStatus | 'pending', string]> = [
  ['pending', 'Still to go'],
  ['delivered', 'Delivered'],
  ['sent', 'Sent'],
  ['held', 'Held'],
  ['bounced', 'Bounced'],
  ['complained', 'Spam'],
  ['failed', 'Failed'],
  ['dropped', 'Dropped']
]

/**
 * The server's mail, for its head admins.
 *
 * How much of the day and the month has gone — counted by the server and by
 * the provider, whichever says more — what is waiting and why, every message
 * and what became of it, and the addresses mail is no longer sent to. Head
 * admins only, because all of it is members' addresses.
 */
export function EmailAdminPage(props: EmailAdminPageProps): JSX.Element {
  const { overview, overviewError } = props

  return (
    <SettingsPage
      title="Email"
      intro="What this server emails — invites, reset links, confirmations — and how much of the provider's allowance it has used. Mail is held rather than sent past the limits, so the provider never has to refuse it."
    >
      {overview === null ? (
        <EmptyState
          icon={<Icon.Mail width={20} height={20} />}
          title="This server does not send mail"
          description="Email needs Foxfire Server 0.5.0 or newer."
        />
      ) : overviewError ? (
        <EmptyState
          tone="error"
          icon={<Icon.Warning width={20} height={20} />}
          title="Could not read the server's email"
          description={overviewError}
        />
      ) : overview === undefined ? (
        <div className="h-40 animate-pulse rounded-lg border border-hairline bg-surface" aria-busy />
      ) : !overview.configured ? (
        <NotConfigured />
      ) : (
        <>
          <Status overview={overview} />
          <Quota overview={overview} />
          <TestSend onSend={props.onSendTest} defaultAddress={props.defaultTestAddress} />
          <Log {...props} />
          <Suppressions {...props} />
        </>
      )}
    </SettingsPage>
  )
}

function NotConfigured(): JSX.Element {
  return (
    <SettingsCard title="No email provider">
      <SettingsBlock>
        <p className="text-sm leading-relaxed text-text-dim">
          This server sends no mail, so invite and reset links are yours to copy and pass on, and members
          can&apos;t reset their own password. To send mail through Resend, set these and restart the server:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-hairline bg-surface-2 p-3 text-2xs text-text-dim">
          {[
            'EMAIL_PROVIDER=resend',
            'EMAIL_FROM_ADDRESS=foxfire@mail.your-domain.gg',
            'RESEND_API_KEY=re_…',
            'RESEND_WEBHOOK_SECRET=whsec_…   # optional: delivery and bounces'
          ].join('\n')}
        </pre>
        <p className="mt-2 text-2xs text-text-mute">See apps/server/docker/.env.example for the rest, and the limits.</p>
      </SettingsBlock>
    </SettingsCard>
  )
}

function Status({ overview }: { overview: EmailOverview }): JSX.Element | null {
  const { queue } = overview

  return (
    <SettingsCard title="Sending">
      {overview.refused && (
        <StatusRow tone="error">
          {overview.provider} is refusing this server&apos;s mail ({overview.refused}). Check the API key, and that the
          domain mail comes from is verified with {overview.provider}. Everything waits and is tried again every hour.
        </StatusRow>
      )}
      {!overview.tracksDelivery && (
        <StatusRow tone="warn">
          No webhook secret is set, so mail is tracked as far as sent and no further — a bounce goes unnoticed and
          the address is not stopped. Point a webhook at /api/email/webhooks/{overview.provider} and set its secret.
        </StatusRow>
      )}
      <SettingsRow label="Provider" control={<span className="text-sm text-text-dim">{overview.provider}</span>} />
      <SettingsRow label="From" control={<code className="text-2xs text-text-dim">{overview.from}</code>} />
      <SettingsRow
        label="Waiting"
        description={
          queue.held > 0 && queue.nextAttemptAt
            ? `Held mail goes at ${formatWhen(queue.nextAttemptAt)}, or is dropped if its link has expired by then.`
            : 'Mail goes within seconds of being asked for.'
        }
        control={
          <span className={clsx('text-sm tabular-nums', queue.held > 0 ? 'text-amber' : 'text-text-dim')}>
            {queue.queued} queued · {queue.held} held
          </span>
        }
      />
      <SettingsRow
        label="Kept for"
        control={
          <span className="text-sm text-text-dim">
            {overview.retentionDays === 0 ? 'good' : `${overview.retentionDays} days`}
          </span>
        }
      />
    </SettingsCard>
  )
}

function Quota({ overview }: { overview: EmailOverview }): JSX.Element {
  return (
    <SettingsCard
      title="Allowance"
      description={`Resets, confirming an address and security notices always go first. Invites, sign-up confirmations and tests stop at ${Math.round(overview.inviteShare * 100)}% of the day, so the rest is kept for somebody locked out.`}
    >
      {overview.today && <Meter label="Today" window={overview.today} />}
      {overview.month && <Meter label="This month" window={overview.month} />}
    </SettingsCard>
  )
}

function Meter({ label, window }: { label: string; window: EmailQuotaWindow }): JSX.Element {
  const capped = window.limit > 0
  const fraction = capped ? Math.min(1, window.used / window.limit) : 0
  const share = capped && window.standardAllowance !== null ? window.standardAllowance / window.limit : null
  const latched = window.latchedUntil !== null && Date.parse(window.latchedUntil) > Date.now()

  return (
    <SettingsBlock>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text">{label}</span>
        <span className="text-sm tabular-nums text-text-dim">
          {window.used.toLocaleString()}
          {capped ? ` of ${window.limit.toLocaleString()}` : ' · no limit'}
        </span>
      </div>

      {capped && (
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={clsx(
              'h-full rounded-full transition-all',
              fraction >= 1 ? 'bg-red/80' : fraction >= 0.8 ? 'bg-amber/80' : 'bg-accent/70'
            )}
            style={{ width: `${fraction * 100}%` }}
          />
          {share !== null && share < 1 && (
            <div
              className="absolute top-0 h-full w-px bg-text-mute"
              style={{ left: `${share * 100}%` }}
              title="Where invites stop"
            />
          )}
        </div>
      )}

      <p className="mt-1.5 text-2xs leading-relaxed text-text-mute">
        {latched
          ? `The provider says this is spent; nothing goes until ${formatWhen(window.latchedUntil!)}.`
          : `Resets ${formatWhen(window.resetsAt)}.`}{' '}
        This server sent {window.ours.toLocaleString()}
        {window.reported !== null ? `; the provider counts ${window.reported.toLocaleString()}, anything else on the account included` : ''}.
      </p>
    </SettingsBlock>
  )
}

function TestSend({
  onSend,
  defaultAddress
}: {
  onSend: (to: string) => Promise<AdminActionResult>
  defaultAddress?: string
}): JSX.Element {
  const [to, setTo] = useState(defaultAddress ?? '')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<AdminActionResult | null>(null)

  function send(): void {
    setSending(true)
    onSend(to)
      .then(setResult)
      .catch((err: unknown) => setResult({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setSending(false))
  }

  return (
    <SettingsCard title="Send a test">
      <SettingsBlock description="Checks the key, the domain and — if a webhook is set — delivery, end to end. It counts against the allowance like any invite.">
        <div className="flex gap-2">
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !sending) send()
            }}
            placeholder="you@example.com"
            spellCheck={false}
            autoCapitalize="off"
            className={clsx(inputClass, 'flex-1')}
          />
          <button type="button" disabled={sending || to.trim() === ''} className={primaryButtonClass} onClick={send}>
            {sending ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </SettingsBlock>
      {result &&
        (result.ok ? (
          <StatusRow tone="good">On its way — it shows in the log below.</StatusRow>
        ) : (
          <StatusRow tone="error">{result.error}</StatusRow>
        ))}
    </SettingsCard>
  )
}

function Log({
  log,
  logTotal,
  filters,
  onFilters,
  hasMoreLog,
  loadingMoreLog,
  onShowMoreLog
}: EmailAdminPageProps): JSX.Element {
  return (
    <SettingsCard title="Sent mail" description="Every email this server sent or meant to, newest first. Never the message itself: it carried a link.">
      <SettingsBlock>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filters.q}
            onChange={(e) => onFilters({ ...filters, q: e.target.value })}
            placeholder="Find by address"
            spellCheck={false}
            autoCapitalize="off"
            aria-label="Find by address"
            className={clsx(inputClass, 'min-w-[12rem] flex-1')}
          />
          <select
            value={filters.kind}
            onChange={(e) => onFilters({ ...filters, kind: e.target.value as EmailLogFilters['kind'] })}
            className={selectClass}
            aria-label="Kind"
          >
            <option value="">Every kind</option>
            {KINDS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => onFilters({ ...filters, status: e.target.value as EmailLogFilters['status'] })}
            className={selectClass}
            aria-label="Status"
          >
            <option value="">Any status</option>
            {STATUSES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {logTotal !== undefined && (
            <span className="shrink-0 text-2xs tabular-nums text-text-mute">
              {logTotal.toLocaleString()} {logTotal === 1 ? 'email' : 'emails'}
            </span>
          )}
        </div>
      </SettingsBlock>

      {log === undefined && <SettingsRow label="Loading…" />}

      {log !== undefined && log.length === 0 && (
        <SettingsBlock>
          <EmptyState
            icon={<Icon.Mail />}
            title="Nothing here"
            description="Mail the server sends shows up here — invites with an address, reset links, confirmations."
          />
        </SettingsBlock>
      )}

      {log?.map((entry) => <LogRow key={entry.id} entry={entry} />)}

      {hasMoreLog && <ShowMoreButton variant="settings" onClick={onShowMoreLog} loading={loadingMoreLog} />}
    </SettingsCard>
  )
}

function LogRow({ entry }: { entry: EmailLogEntry }): JSX.Element {
  const tone = statusTone(entry.status)
  const kind = KINDS.find(([key]) => key === entry.kind)?.[1] ?? entry.kind

  return (
    <SettingsRow
      label={<span className="truncate">{entry.recipient}</span>}
      description={
        <>
          {kind} · {new Date(entry.createdAt).toLocaleString()}
          {entry.triggeredBy && ` · by ${entry.triggeredBy}`}
          {entry.attempts > 1 && ` · ${entry.attempts} attempts`}
          {detailFor(entry) && <span className="mt-0.5 block text-text-dim">{detailFor(entry)}</span>}
        </>
      }
      control={
        <span
          className={clsx(
            'rounded px-1.5 py-0.5 text-2xs font-medium',
            tone === 'good' && 'bg-teal/15 text-teal',
            tone === 'normal' && 'bg-surface-2 text-text-dim',
            tone === 'warn' && 'bg-amber/15 text-amber',
            tone === 'bad' && 'bg-red/15 text-red'
          )}
        >
          {statusLabel(entry.status)}
        </span>
      }
    />
  )
}

function detailFor(entry: EmailLogEntry): string | null {
  if (entry.status === 'held') {
    return `${heldReason(entry.reason)}${entry.notBefore ? ` — next try ${formatWhen(entry.notBefore)}` : ''}`
  }

  if (entry.detail) return entry.detail
  if (entry.reason && entry.status !== 'delivered' && entry.status !== 'sent') return entry.reason.replace(/_/g, ' ')
  return null
}

function Suppressions({
  suppressions,
  suppressionsTotal,
  hasMoreSuppressions,
  loadingMoreSuppressions,
  onShowMoreSuppressions,
  onClearSuppression
}: EmailAdminPageProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  function clear(id: string): void {
    setBusy(id)
    onClearSuppression(id)
      .then((result) => setError(result.ok ? null : result.error))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null))
  }

  return (
    <SettingsCard
      title="Not sending to"
      description="Addresses that bounced for good, marked mail as spam, or that the provider has given up on. Sending again would only bounce again. Clear one once it's fixed; if it bounces again it comes straight back."
    >
      {error && <StatusRow tone="error">{error}</StatusRow>}

      {suppressions === undefined && <SettingsRow label="Loading…" />}

      {suppressions !== undefined && suppressions.length === 0 && (
        <SettingsRow label="None" description="Every address mail has gone to still takes it." />
      )}

      {suppressions?.map((s) => (
        <SettingsRow
          key={s.id}
          label={<span className="truncate">{s.address}</span>}
          description={
            <>
              {s.reason === 'hard_bounce' ? 'Bounced' : s.reason === 'complaint' ? 'Marked as spam' : 'Suppressed by the provider'}{' '}
              · {new Date(s.createdAt).toLocaleDateString()}
              {s.member && ` · ${s.member} signs in with it`}
              {s.detail && <span className="mt-0.5 block text-text-dim">{s.detail}</span>}
            </>
          }
          control={
            <button type="button" disabled={busy === s.id} className={ghostButtonClass} onClick={() => clear(s.id)}>
              Clear
            </button>
          }
        />
      ))}

      {hasMoreSuppressions && (
        <ShowMoreButton variant="settings" onClick={onShowMoreSuppressions} loading={loadingMoreSuppressions} />
      )}

      {suppressionsTotal !== undefined && suppressionsTotal > 0 && (
        <p className="px-4 pb-3 text-2xs text-text-mute">{suppressionsTotal} altogether.</p>
      )}
    </SettingsCard>
  )
}
