import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Icon } from '@foxfire/ui'
import { useEmailVerificationNudge, useResendEmailConfirmation } from '@foxfire/screens'

/**
 * Asks a member to confirm their address, on a server that sends mail.
 *
 * Nothing is locked behind it. What confirming buys is being able to reset a
 * forgotten password without asking an admin, so that is what the banner says
 * — once per page load: dismissing it hides it until the next.
 */
export function EmailBanner(): JSX.Element | null {
  const nudge = useEmailVerificationNudge()
  const resend = useResendEmailConfirmation()
  const [dismissed, setDismissed] = useState(false)

  if (!nudge || dismissed) return null

  const outcome = resend.data
  const waiting = nudge.canResendAt !== null && Date.parse(nudge.canResendAt) > Date.now()

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber/30 bg-amber/10 px-5 py-2 text-sm text-amber">
      <Icon.Mail className="shrink-0" />
      <span className="min-w-0 flex-1">
        {nudge.kind === 'pending' ? (
          <>
            Open the link we emailed to <strong className="font-medium">{nudge.address}</strong> to finish moving
            your account to it.
          </>
        ) : nudge.suppressed ? (
          <>
            Mail to <strong className="font-medium">{nudge.address}</strong> bounced, so it can&rsquo;t be confirmed.{' '}
            <Link to="/account" className="underline underline-offset-2">
              Change your address
            </Link>
            .
          </>
        ) : (
          <>
            Confirm <strong className="font-medium">{nudge.address}</strong> so you can reset your password yourself if
            you forget it.
          </>
        )}
        {outcome && !outcome.ok && <span className="ml-2 text-red">{outcome.error}</span>}
        {outcome?.ok && <span className="ml-2">Sent — check your inbox.</span>}
      </span>
      {!nudge.suppressed && (
        <button
          type="button"
          disabled={resend.isPending || waiting}
          onClick={() => resend.mutate()}
          className="shrink-0 rounded-md border border-amber/40 px-2.5 py-0.5 text-xs transition hover:bg-amber/10 disabled:opacity-50"
        >
          {resend.isPending ? 'Sending…' : 'Send the link again'}
        </button>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Not now"
        className="shrink-0 rounded p-1 transition hover:bg-amber/10"
      >
        <Icon.Close width={12} height={12} />
      </button>
    </div>
  )
}
