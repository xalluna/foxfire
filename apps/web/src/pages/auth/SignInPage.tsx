import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { fieldLabelClass, inputClass, primaryButtonClass } from '@foxfire/ui'
import { safeRedirect } from '../../routes/redirect'
import { describeError } from '../../serverInfo'
import { signIn } from '../../session/session'
import { AuthLayout, FormError } from './AuthLayout'

export function SignInPage(): JSX.Element {
  const { redirect } = useSearch({ from: '/sign-in' })
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await signIn({ email: email.trim(), password })
      await navigate({ href: safeRedirect(redirect), replace: true })
    } catch (err) {
      // Wrong details, a disabled account, or too many attempts from here —
      // the server says which, and a rate limit is not a sign-out.
      setError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="text-accent underline-offset-2 hover:underline">
            Make an account
          </Link>
        </>
      }
    >
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

        <label className="block space-y-1">
          <span className={fieldLabelClass}>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} w-full`}
          />
        </label>

        <FormError message={error} />

        <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}
