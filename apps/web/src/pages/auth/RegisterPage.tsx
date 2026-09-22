import { Link } from '@tanstack/react-router'
import { useServerInfo } from '../../serverInfo'
import { AuthLayout } from './AuthLayout'
import { RegisterForm } from './RegisterForm'

/**
 * Making an account without an invite.
 *
 * Always offered, even on an invite-only server: the server decides who may
 * register, and its administrator's own address is always let in — so a page
 * that hid the form would lock the owner out of their own server. It says the
 * server is invite-only when it is, and the server's refusal says the rest.
 */
export function RegisterPage(): JSX.Element {
  const server = useServerInfo()
  const inviteOnly = server.data?.publicSignup === false

  return (
    <AuthLayout
      title="Make an account"
      subtitle={
        inviteOnly
          ? 'This server is invite-only. If you were sent an invite, open its link instead — it fills this in.'
          : 'Everybody on this server can see everybody’s match history. What you can change is your own.'
      }
      footer={
        <>
          Already have one?{' '}
          <Link to="/sign-in" className="text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthLayout>
  )
}
