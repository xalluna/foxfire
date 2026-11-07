import { Link, useParams } from '@tanstack/react-router'
import { Skeleton } from '@foxfire/ui'
import { useInvitePreview, useServerInfo } from '../../serverInfo'
import { AuthLayout, FormError } from './AuthLayout'
import { RegisterForm } from './RegisterForm'

/**
 * Where an invite link lands: {PublicUrl}/invite/{token}.
 *
 * It used to be a page the server rendered, which could only say "open
 * Foxfire and paste this". Now it is the sign-up form, filled in from the
 * invite — and the same code still works in the desktop, for somebody who
 * would rather start there.
 *
 * A link that can no longer be used says so in its title as well as its body,
 * and each of the server's reasons carries its own next step. The server's
 * name is already above the card. On a server anybody can join, a spent link —
 * one shared in a channel, say, after its first taker — is not a wall: the
 * page points at signing up without it.
 */
export function InvitePage(): JSX.Element {
  const { token } = useParams({ from: '/invite/$token' })
  const preview = useInvitePreview(token)
  const openSignup = useServerInfo().data?.publicSignup === true

  const title = preview.isError
    ? "Couldn't check this invite"
    : preview.data && !preview.data.usable
      ? "This invite can't be used"
      : "You're invited"

  return (
    <AuthLayout
      title={title}
      subtitle={
        preview.data?.usable
          ? `${preview.data.serverName} is where your friends keep their League history. Make an account to join them.`
          : undefined
      }
      footer={
        <>
          Already have an account?{' '}
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
        <FormError message="This server could not be reached to check the invite. Try the link again in a moment." />
      ) : !preview.data.usable ? (
        <div className="space-y-3">
          <FormError message={preview.data.message} />
          {openSignup && (
            <p className="text-sm text-text-dim">
              Anybody can join this server, though —{' '}
              <Link to="/register" className="text-accent underline-offset-2 hover:underline">
                make an account
              </Link>{' '}
              without the invite.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <RegisterForm inviteToken={token} invitedEmail={preview.data.email} />
          <p className="text-xs leading-relaxed text-text-mute">
            Prefer the desktop app? This invite works there too: connect it to this server&rsquo;s address and
            paste this link as the invite code.
          </p>
        </div>
      )}
    </AuthLayout>
  )
}
