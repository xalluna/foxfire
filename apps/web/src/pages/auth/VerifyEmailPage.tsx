import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { EmailConfirmation } from '@foxfire/core'
import { Skeleton, primaryButtonClass } from '@foxfire/ui'
import { queryKeys } from '@foxfire/screens'
import { confirmEmail, describeError } from '../../serverInfo'
import { session, useAuth } from '../../session/session'
import { AuthLayout, FormError } from './AuthLayout'

/**
 * Where a confirmation link lands: {PublicUrl}/verify-email/{token}.
 *
 * Opening it is the whole errand — the token is the proof — so the page does
 * it on arrival, once, and says what happened. For a new account that is the
 * address confirmed; for a move, the account now signs in with the new one.
 *
 * Signed in or not: the mail is often read on a phone that has never signed
 * in. When this browser is signed in, it catches up with the change, so the
 * banner asking to confirm goes and the account page shows the new address.
 */
export function VerifyEmailPage(): JSX.Element {
  const { token } = useParams({ from: '/verify-email/$token' })
  const queryClient = useQueryClient()
  const signedIn = useAuth((s) => s.user !== null)

  const [result, setResult] = useState<EmailConfirmation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef<string | null>(null)

  useEffect(() => {
    // Once per token, even under React's double-invoked effects in
    // development: a second post would be told the link was already used.
    if (started.current === token) return
    started.current = token
    setResult(null)
    setError(null)

    confirmEmail(token).then(
      async (confirmed) => {
        if (started.current !== token) return
        setResult(confirmed)

        if (useAuth.getState().user) {
          // A renewal re-reads who this is, the address included.
          session.reset()
          await session.restore().then(
            (user) => useAuth.setState({ user }),
            () => undefined
          )
        }

        void queryClient.invalidateQueries({ queryKey: queryKeys.accountEmail() })
      },
      (err: unknown) => {
        if (started.current === token) setError(describeError(err))
      }
    )
  }, [token, queryClient])

  return (
    <AuthLayout
      title={result?.purpose === 'change' ? 'New address confirmed' : 'Confirm your email'}
      footer={
        signedIn ? undefined : (
          <Link to="/sign-in" className="text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
        )
      }
    >
      {error ? (
        <FormError message={error} />
      ) : result === null ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-md border border-teal/30 bg-teal/10 px-3 py-2 text-sm leading-relaxed text-teal">
            {result.email} — {result.message}
          </p>
          {signedIn && (
            <Link to="/" className={`${primaryButtonClass} w-full justify-center`}>
              Carry on
            </Link>
          )}
        </div>
      )}
    </AuthLayout>
  )
}
