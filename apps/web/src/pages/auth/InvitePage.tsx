import { Link, useParams } from '@tanstack/react-router'
import { Skeleton } from '@foxfire/ui'
import { useInvitePreview } from '../../serverInfo'
import { AuthLayout, FormError } from './AuthLayout'
import { RegisterForm } from './RegisterForm'

/**
 * Where an invite link lands: {PublicUrl}/invite/{token}.
 *
 * It used to be a page the server rendered, which could only say "open
 * Foxfire and paste this". Now it is the sign-up form, filled in from the
 * invite — and the same code still works in the desktop, for somebody who
 * would rather start there.
 */
export function InvitePage(): JSX.Element {
  const { token } = useParams({ from: '/invite/$token' })
  const preview = useInvitePreview(token)

  return (
    <AuthLayout
      title="You're invited"
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
        <FormError message={preview.data.message} />
      ) : (
        <div className="space-y-4">
          <RegisterForm inviteToken={token} invitedEmail={preview.data.email} />
          <p className="text-2xs leading-relaxed text-text-mute">
            Prefer the desktop app? This invite works there too: connect it to this server&rsquo;s address and
            paste this link as the invite code.
          </p>
        </div>
      )}
    </AuthLayout>
  )
}
