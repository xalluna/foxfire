import { Link, Navigate } from '@tanstack/react-router'
import type { ShareRefusal } from '../../session/share'
import { useAuth } from '../../session/session'
import { AuthLayout, FormError } from './AuthLayout'

const TITLES: Record<ShareRefusal['reason'], string> = {
  expired: 'This link has expired',
  withdrawn: 'This link was withdrawn',
  invalid: "This link doesn't work",
  unreachable: "This link couldn't be opened"
}

/**
 * Where a share link that opens nothing lands: expired, withdrawn, not one of
 * this server's, or a server that did not answer.
 *
 * Its own page rather than the sign-in form, because whoever followed a shared
 * profile is usually not a member and a password box answers a question they
 * did not ask. The way to sign in is still here, for a member who was sent one.
 * Reached whether the link was dead on arrival or stopped working while the
 * profile was open.
 */
export function SharedLinkPage(): JSX.Element {
  const refused = useAuth((s) => s.shareRefused)
  const signedIn = useAuth((s) => s.user !== null)

  if (!refused || signedIn) return <Navigate to="/" replace />

  return (
    <AuthLayout
      title={TITLES[refused.reason]}
      footer={
        <p>
          A member of this server?{' '}
          <Link to="/sign-in" className="text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      {refused.reason === 'unreachable' ? (
        <FormError message={refused.message} />
      ) : (
        <p className="text-sm leading-relaxed text-text-dim">{refused.message}</p>
      )}
    </AuthLayout>
  )
}
