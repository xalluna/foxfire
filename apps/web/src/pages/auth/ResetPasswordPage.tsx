import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  Skeleton,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
  readonlyInputClass
} from '@foxfire/ui'
import { MINIMUM_PASSWORD, passwordProblem } from '@foxfire/core/server'
import { describeError, usePasswordResetPreview } from '../../serverInfo'
import { redeemPasswordReset } from '../../session/session'
import { AuthLayout, FormError } from './AuthLayout'

/**
 * Where a reset link lands: {PublicUrl}/reset-password/{token}.
 *
 * The same shape as the invite page, because it is the same errand — somebody
 * arriving from a message with a token, who cannot sign in. The preview says
 * whose account it sets before they type anything, so nobody sets a password on
 * an account they did not mean.
 *
 * Using it signs them in here. They have just proved they hold the link, and
 * asking them to type the password they invented four seconds ago into a
 * sign-in form proves nothing further.
 */
export function ResetPasswordPage(): JSX.Element {
  const { token } = useParams({ from: '/reset-password/$token' })
  const preview = usePasswordResetPreview(token)

  return (
    <AuthLayout
      title="Set a new password"
      subtitle={
        preview.data?.usable
          ? `For ${preview.data.username ?? 'your account'} on ${preview.data.serverName}. Everything else signed in to this account will be signed out.`
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
      {preview.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : preview.isError ? (
        <FormError message="This server could not be reached to check the link. Try it again in a moment." />
      ) : !preview.data.usable ? (
        <FormError message={`${preview.data.message} Ask whoever sent it for a new one.`} />
      ) : (
        <ResetForm token={token} email={preview.data.email} />
      )}
    </AuthLayout>
  )
}

function ResetForm({ token, email }: { token: string; email: string | null }): JSX.Element {
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    const problem = passwordProblem(password, confirmation)
    if (problem !== null) {
      setError(problem)
      return
    }

    setPending(true)
    setError(null)

    try {
      await redeemPasswordReset(token, password)
      await navigate({ to: '/', replace: true })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      {/* Shown and not editable: the link decides whose password this is. It is
          also what a password manager reads to know which entry it is being
          asked to update, which a hidden field would not reliably give it. */}
      {email !== null && (
        <label className="block space-y-1">
          <span className={fieldLabelClass}>Account</span>
          <input
            type="email"
            value={email}
            readOnly
            autoComplete="username"
            className={`${readonlyInputClass} w-full`}
          />
        </label>
      )}

      <label className="block space-y-1">
        <span className={fieldLabelClass}>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${inputClass} w-full`}
        />
        <span className="block text-2xs text-text-mute">At least {MINIMUM_PASSWORD} characters.</span>
      </label>

      <label className="block space-y-1">
        <span className={fieldLabelClass}>Confirm new password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className={`${inputClass} w-full`}
        />
      </label>

      <FormError message={error} />

      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
        {pending ? 'Setting your password…' : 'Set password and sign in'}
      </button>
    </form>
  )
}
