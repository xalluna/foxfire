import type {
  AccountEmail,
  AccountEmailResult,
  AdminActionResult,
  EmailDelivery,
  EmailKind,
  EmailLogEntry,
  EmailLogQuery,
  EmailOverview,
  EmailStatus,
  EmailSuppression,
  EmailSuppressionQuery,
  Page
} from '@foxfire/core'
import { pageOf } from '@foxfire/core'
import { delay, scenario } from './scenario'

/**
 * A server's mail, for the harness: the Email page's quota, queue, log and
 * suppressions, and the signed-in member's own address.
 *
 * `email-off` is a server with no provider; `email-held` one whose day is spent
 * and whose mail is waiting; `unverified` a member who never confirmed their
 * address; `email-change-pending` one moving to a new one. Everything else is a
 * server with mail on, most of the day's allowance still there.
 */
export const MAIL_ON = scenario !== 'email-off'

const HOUR = 3_600_000
const now = Date.now()
const iso = (at: number): string => new Date(at).toISOString()

/** The start of today in UTC, and of tomorrow. */
const dayStart = (() => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
})()
const dayEnd = dayStart + 24 * HOUR
const monthStart = (() => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
})()
const monthEnd = (() => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
})()

export function delivery(status: EmailStatus, hoursAgo: number, reason: string | null = null): EmailDelivery {
  const at = now - hoursAgo * HOUR
  return {
    status,
    reason,
    queuedAt: iso(at),
    notBefore: status === 'held' ? iso(dayEnd) : null,
    sentAt: status === 'queued' || status === 'held' || status === 'dropped' ? null : iso(at + 4_000),
    deliveredAt: status === 'delivered' ? iso(at + 9_000) : null
  }
}

const HELD = scenario === 'email-held'

let log: EmailLogEntry[] = buildLog()

let suppressions: EmailSuppression[] = [
  {
    id: 's-1',
    address: 'gon@example.com',
    reason: 'hard_bounce',
    detail: 'Permanent · General · The email account that you tried to reach does not exist.',
    createdAt: iso(now - 30 * HOUR),
    member: null
  },
  {
    id: 's-2',
    address: 'old.address@example.org',
    reason: 'complaint',
    detail: null,
    createdAt: iso(now - 9 * 24 * HOUR),
    member: 'ward andersen'
  }
]

function buildLog(): EmailLogEntry[] {
  const kinds: EmailKind[] = ['invite', 'verification', 'password_reset', 'password_changed', 'email_change', 'test']
  const statuses: EmailStatus[] = ['delivered', 'delivered', 'delivered', 'sent', 'bounced', 'delivered', 'failed', 'dropped']

  const entries = Array.from({ length: 140 }, (_, i): EmailLogEntry => {
    const kind = kinds[i % kinds.length]
    const status = statuses[i % statuses.length]
    const at = now - (i + 1) * 2.7 * HOUR

    return {
      id: `m-${i}`,
      kind,
      recipient: `summoner${String(i % 60).padStart(3, '0')}@example.net`,
      subject: subjectFor(kind),
      status,
      reason:
        status === 'bounced' ? 'hard_bounce' : status === 'failed' ? 'validation_error' : status === 'dropped' ? 'expired' : null,
      detail: status === 'bounced' ? 'Permanent · General · No such user here' : null,
      attempts: status === 'dropped' ? 0 : 1,
      createdAt: iso(at),
      notBefore: null,
      sentAt: status === 'dropped' ? null : iso(at + 3_000),
      deliveredAt: status === 'delivered' ? iso(at + 8_000) : null,
      lastEventAt: status === 'delivered' || status === 'bounced' ? iso(at + 8_000) : null,
      triggeredBy: kind === 'invite' || kind === 'test' ? 'Faker' : null
    }
  })

  const waiting: EmailLogEntry[] = HELD
    ? Array.from({ length: 6 }, (_, i): EmailLogEntry => ({
        id: `m-held-${i}`,
        kind: i === 0 ? 'password_reset' : 'invite',
        recipient: `waiting${i}@example.com`,
        subject: subjectFor(i === 0 ? 'password_reset' : 'invite'),
        status: 'held',
        reason: i === 0 ? 'daily_limit' : 'standard_share',
        detail: null,
        attempts: 0,
        createdAt: iso(now - (i + 1) * 0.4 * HOUR),
        notBefore: iso(dayEnd),
        sentAt: null,
        deliveredAt: null,
        lastEventAt: null,
        triggeredBy: i === 0 ? null : 'Faker'
      }))
    : []

  return [...waiting, ...entries]
}

function subjectFor(kind: EmailKind): string {
  switch (kind) {
    case 'invite':
      return "You're invited to The Fox Den"
    case 'password_reset':
      return 'Reset your The Fox Den password'
    case 'verification':
      return 'Confirm your email for The Fox Den'
    case 'email_change':
      return 'Confirm your new email for The Fox Den'
    case 'password_changed':
      return 'Your The Fox Den password was changed'
    case 'test':
      return 'A test email from The Fox Den'
  }
}

export function fixtureEmailOverview(): Promise<EmailOverview | null> {
  if (!MAIL_ON) {
    return delay(
      {
        configured: false,
        provider: null,
        from: null,
        tracksDelivery: false,
        inviteShare: 0.8,
        retentionDays: 90,
        today: null,
        month: null,
        queue: { queued: 0, held: 0, nextAttemptAt: null },
        suppressed: 0,
        refused: null
      },
      200
    )
  }

  const sentToday = log.filter((e) => e.sentAt && Date.parse(e.sentAt) >= dayStart).length
  const today = HELD ? 100 : Math.min(sentToday + 23, 100)
  const held = log.filter((e) => e.status === 'held').length

  return delay(
    {
      configured: true,
      provider: 'resend',
      from: '"The Fox Den" <foxfire@mail.foxden.gg>',
      tracksDelivery: true,
      inviteShare: 0.8,
      retentionDays: 90,
      today: {
        used: today,
        ours: HELD ? 96 : sentToday + 21,
        reported: today,
        reportedAt: iso(now - 0.3 * HOUR),
        limit: 100,
        standardAllowance: 80,
        startsAt: iso(dayStart),
        resetsAt: iso(dayEnd),
        latchedUntil: null
      },
      month: {
        used: HELD ? 2_140 : 1_218,
        ours: HELD ? 2_120 : 1_190,
        reported: HELD ? 2_140 : 1_218,
        reportedAt: iso(now - 0.3 * HOUR),
        limit: 3_000,
        standardAllowance: null,
        startsAt: iso(monthStart),
        resetsAt: iso(monthEnd),
        latchedUntil: null
      },
      queue: { queued: 0, held, nextAttemptAt: held > 0 ? iso(dayEnd) : null },
      suppressed: suppressions.length,
      refused: null
    },
    200
  )
}

export function fixtureEmailLog(query: EmailLogQuery = {}): Promise<Page<EmailLogEntry> | null> {
  if (!MAIL_ON && log.length === 0) return delay(pageOf([], query), 200)

  const needle = (query.q ?? '').trim().toLowerCase()
  const matching = log
    .filter((e) => !query.kind || e.kind === query.kind)
    .filter((e) =>
      !query.status
        ? true
        : query.status === 'pending'
          ? e.status === 'queued' || e.status === 'sending' || e.status === 'held'
          : e.status === query.status
    )
    .filter((e) => needle.length === 0 || e.recipient.toLowerCase().includes(needle))

  return delay(pageOf(matching, query), 240)
}

export function fixtureEmailSuppressions(query: EmailSuppressionQuery = {}): Promise<Page<EmailSuppression> | null> {
  const needle = (query.q ?? '').trim().toLowerCase()
  return delay(pageOf(suppressions.filter((s) => needle.length === 0 || s.address.includes(needle)), query), 200)
}

export function fixtureClearSuppression(id: string): Promise<AdminActionResult> {
  suppressions = suppressions.filter((s) => s.id !== id)
  return delay({ ok: true, error: null }, 200, false)
}

export function fixtureSendTestEmail(to: string): Promise<AdminActionResult> {
  if (!MAIL_ON) {
    return delay({ ok: false, error: 'This server has no email provider configured, so there is nothing to test.' }, 200, false)
  }

  if (!to.includes('@')) return delay({ ok: false, error: 'That does not look like an email address.' }, 150, false)

  const at = Date.now()
  log = [
    {
      id: `m-test-${at}`,
      kind: 'test',
      recipient: to.trim(),
      subject: subjectFor('test'),
      status: HELD ? 'held' : 'sent',
      reason: HELD ? 'standard_share' : null,
      detail: null,
      attempts: HELD ? 0 : 1,
      createdAt: iso(at),
      notBefore: HELD ? iso(dayEnd) : null,
      sentAt: HELD ? null : iso(at + 1_000),
      deliveredAt: null,
      lastEventAt: null,
      triggeredBy: 'Faker'
    },
    ...log
  ]

  return delay({ ok: true, error: null }, 300, false)
}

/* ---------------------------------------------------------------------------- */
/* The signed-in member's own address                                           */
/* ---------------------------------------------------------------------------- */

let accountEmail: AccountEmail = {
  email: 'faker@example.com',
  emailConfirmed: scenario !== 'unverified',
  pendingEmail: scenario === 'email-change-pending' ? 'faker.new@example.com' : null,
  pendingExpiresAt: scenario === 'email-change-pending' ? iso(now + 6 * 24 * HOUR) : null,
  lastSentAt: scenario === 'unverified' || scenario === 'email-change-pending' ? iso(now - 2 * HOUR) : null,
  canResendAt: null,
  mailEnabled: MAIL_ON,
  suppressed: false
}

/** The signed-in member's address. The screens ask only when somebody is signed in to a server. */
export function fixtureAccountEmail(): Promise<AccountEmail | null> {
  return delay(accountEmail, 150, false)
}

export function fixtureResendConfirmation(): Promise<AccountEmailResult> {
  if (!MAIL_ON) {
    return delay({ ok: false, error: "This server doesn't send email, so there is nothing to confirm with.", email: null }, 200, false)
  }

  if (accountEmail.canResendAt && Date.parse(accountEmail.canResendAt) > Date.now()) {
    return delay({ ok: false, error: 'A link was sent a moment ago. You can ask for another in ten minutes.', email: null }, 200, false)
  }

  accountEmail = {
    ...accountEmail,
    lastSentAt: iso(Date.now()),
    canResendAt: iso(Date.now() + 10 * 60_000)
  }

  return delay({ ok: true, error: null, email: accountEmail }, 300, false)
}

export function fixtureCancelEmailChange(): Promise<AccountEmailResult> {
  accountEmail = { ...accountEmail, pendingEmail: null, pendingExpiresAt: null }
  return delay({ ok: true, error: null, email: accountEmail }, 250, false)
}
