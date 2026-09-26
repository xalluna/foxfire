import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Skeleton, fieldLabelClass, inputClass, primaryButtonClass } from '@foxfire/ui'
import { describeError, requestPasswordReset, useServerInfo } from '../../serverInfo'
import { AuthLayout, FormError } from './AuthLayout'

/**
 * "Forgot password?" — where the sign-in page sends somebody who cannot get in.
 *
 * The answer never says whether the address has an account here: the server
 * gives the same one either way, so a stranger cannot use this page to find
 * out who is on a private server. A link goes only to an address its owner has
 * confirmed, and only once while it is live — asking again sends nothing new.
 *
 * On a server that sends no mail there is nothing to send, and the page says
 * so, as the sign-in page does.
 */
export function ForgotPasswordPage(): JSX.Element {
  const server = useServerInfo()

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const answer = await requestPasswordReset(email.trim())
      setSent(answer.message)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle={
        server.data?.email && sent === null
          ? "Give the address you sign in with, and if it's one you've confirmed, a link to set a new password is emailed to it."
          : undefined
      }
      footer={
        <>
          Remembered it?{' '}
          <Link to="/sign-in" className="text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {server.isPending ? (
        <Skeleton className="h-8 w-full" />
      ) : !server.data?.email ? (
        <p className="text-sm leading-relaxed text-text-dim">
          This server doesn&rsquo;t send email, so it can&rsquo;t send you a reset link. Ask its administrator
          for one — they can make it from the Members page and pass it on.
        </p>
      ) : sent !== null ? (
        <div className="space-y-3">
          <p className="rounded-md border border-teal/30 bg-teal/10 px-3 py-2 text-sm leading-relaxed text-teal">
            {sent}
          </p>
          <p className="text-2xs leading-relaxed text-text-mute">
            Only one link is out at a time: asking again while it works sends nothing new, so look for the
            first one. Never confirmed your address? Then nothing was sent — ask an administrator instead.
          </p>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          <label className="block space-y-1">
            <span className={fieldLabelClass}>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </label>

          <FormError message={error} />

          <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
            {pending ? 'Sending…' : 'Email me a link'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
