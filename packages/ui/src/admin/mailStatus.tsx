import clsx from 'clsx'
import type { EmailDelivery, EmailStatus } from '@foxfire/core'

export type MailTone = 'good' | 'normal' | 'warn' | 'bad'

/**
 * What became of an email, in the words an admin reads beside an invite or a
 * reset — and how worried to look.
 */
export function describeMail(mail: EmailDelivery): { text: string; tone: MailTone } {
  switch (mail.status) {
    case 'queued':
    case 'sending':
      return { text: 'Emailing now', tone: 'normal' }
    case 'held':
      return {
        text: `Email waiting${mail.notBefore ? ` until ${formatWhen(mail.notBefore)}` : ''} — ${heldReason(mail.reason)}`,
        tone: 'warn'
      }
    case 'sent':
      return { text: mail.reason === 'delayed' ? 'Emailed · delivery delayed' : 'Emailed', tone: 'normal' }
    case 'delivered':
      return { text: 'Emailed · delivered', tone: 'good' }
    case 'bounced':
      return {
        text: mail.reason === 'hard_bounce' ? "Email bounced — that address doesn't exist" : 'Email bounced — try again later',
        tone: 'bad'
      }
    case 'complained':
      return { text: 'Email marked as spam by the recipient', tone: 'bad' }
    case 'failed':
      return { text: 'Email could not be sent', tone: 'bad' }
    case 'dropped':
      return { text: droppedReason(mail.reason), tone: 'warn' }
  }
}

/** One line of mail status, coloured by how it went. */
export function MailStatus({ mail, className }: { mail: EmailDelivery; className?: string }): JSX.Element {
  const { text, tone } = describeMail(mail)

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 text-2xs',
        tone === 'good' && 'text-teal',
        tone === 'normal' && 'text-text-dim',
        tone === 'warn' && 'text-amber',
        tone === 'bad' && 'text-red',
        className
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'h-1.5 w-1.5 rounded-full',
          tone === 'good' && 'bg-teal',
          tone === 'normal' && 'bg-text-mute',
          tone === 'warn' && 'bg-amber',
          tone === 'bad' && 'bg-red'
        )}
      />
      {text}
    </span>
  )
}

/** A status as the log lists it: one word. */
export function statusLabel(status: EmailStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'sending':
      return 'Sending'
    case 'held':
      return 'Held'
    case 'sent':
      return 'Sent'
    case 'delivered':
      return 'Delivered'
    case 'bounced':
      return 'Bounced'
    case 'complained':
      return 'Spam'
    case 'failed':
      return 'Failed'
    case 'dropped':
      return 'Dropped'
  }
}

export function statusTone(status: EmailStatus): MailTone {
  switch (status) {
    case 'delivered':
      return 'good'
    case 'held':
    case 'dropped':
      return 'warn'
    case 'bounced':
    case 'complained':
    case 'failed':
      return 'bad'
    default:
      return 'normal'
  }
}

export function heldReason(reason: string | null): string {
  switch (reason) {
    case 'daily_limit':
      return "today's limit is reached"
    case 'monthly_limit':
      return "this month's limit is reached"
    case 'standard_share':
      return "today's share for invites is used up"
    case 'provider_quota':
      return 'the provider says the quota is spent'
    case 'provider_refused':
      return 'the provider is refusing this server'
    default:
      return 'waiting its turn'
  }
}

function droppedReason(reason: string | null): string {
  switch (reason) {
    case 'expired':
      return 'Not emailed — the link expired while it waited'
    case 'revoked':
      return 'Not emailed — withdrawn'
    case 'suppressed':
    case 'provider_suppressed':
      return 'Not emailed — mail to that address bounced before'
    default:
      return 'Not emailed'
  }
}

/** A moment in the near future or past, in the reader's own clock. */
export function formatWhen(iso: string): string {
  const at = new Date(iso)
  const today = new Date()
  const sameDay = at.toDateString() === today.toDateString()

  return sameDay
    ? at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
