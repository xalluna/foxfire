import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { fieldLabelClass, inputClass, primaryButtonClass, readonlyInputClass } from '@foxfire/ui'
import { describeError } from '../../serverInfo'
import { register } from '../../session/session'
import { FormError } from './AuthLayout'

/** Identity counts length, not character classes — see Program.cs on the server. */
const MINIMUM_PASSWORD = 12

/**
 * Making an account, with or without an invite.
 *
 * With one, the address it was sent to is filled in and fixed: the server only
 * lets an invite register the address it names, so offering to change it would
 * only offer a refusal.
 */
export function RegisterForm({
  inviteToken,
  invitedEmail
}: {
  inviteToken?: string
  invitedEmail?: string | null
}): JSX.Element {
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState(invitedEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (password.length < MINIMUM_PASSWORD) {
      setError(`A password is at least ${MINIMUM_PASSWORD} characters. Length is what makes one hard to guess.`)
      return
    }

    setPending(true)
    setError(null)

    try {
      await register({ username: username.trim(), email: email.trim(), password, inviteToken })
      await navigate({ to: '/', replace: true })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <label className="block space-y-1">
        <span className={fieldLabelClass}>Username</span>
        <input
          autoComplete="username"
          required
          minLength={3}
          maxLength={32}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={`${inputClass} w-full`}
        />
        <span className="block text-2xs text-text-mute">What everybody here sees beside your games.</span>
      </label>

      <label className="block space-y-1">
        <span className={fieldLabelClass}>Email</span>
        {invitedEmail ? (
          <input value={invitedEmail} readOnly className={`${readonlyInputClass} w-full`} />
        ) : (
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} w-full`}
          />
        )}
        <span className="block text-2xs text-text-mute">What you sign in with.</span>
      </label>

      <label className="block space-y-1">
        <span className={fieldLabelClass}>Password</span>
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

      <FormError message={error} />

      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
        {pending ? 'Making your account…' : 'Make my account'}
      </button>
    </form>
  )
}
