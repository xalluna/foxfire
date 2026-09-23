import { useEffect, type ReactNode } from 'react'
import { Link, Outlet, useRouter } from '@tanstack/react-router'
import { Icon, Logo } from '@foxfire/ui'
import { useConnection } from '@foxfire/screens'
import { signOut, useAuth } from '../session/session'

function NavLink({ to, children }: { to: '/players' | '/search' | '/admin'; children: ReactNode }): JSX.Element {
  return (
    <Link
      to={to}
      className="shrink-0 rounded px-2.5 py-1 text-sm transition"
      activeProps={{ className: 'bg-accent/10 text-accent' }}
      inactiveProps={{ className: 'text-text-dim hover:bg-surface hover:text-text' }}
    >
      {children}
    </Link>
  )
}

/**
 * Everything after signing in: the server's name, where to go, who you are.
 *
 * Also where a session that ends underneath the page is noticed — revoked by an
 * admin, signed out in another tab, expired — and turned into the sign-in page,
 * with the way back to where it was.
 */
export function WebShell(): JSX.Element {
  const user = useAuth((s) => s.user)
  const connection = useConnection()
  const router = useRouter()

  // Read where this page is at the moment the session ends, not as a
  // dependency: this layout stays mounted while the navigation to sign-in is
  // under way, and following the address would send it again from the
  // sign-in page itself, a redirect inside a redirect.
  useEffect(() => {
    if (user) return
    const { href, pathname } = router.state.location
    if (pathname === '/sign-in') return
    void router.navigate({ to: '/sign-in', search: { redirect: href }, replace: true })
  }, [user, router])

  return (
    <div className="min-h-screen bg-canvas text-text">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/95 backdrop-blur">
        {/* As wide as the widest page below it — see WebPlayerLayout. */}
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-4 max-md:gap-2 max-md:px-2">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <Logo className="shrink-0 text-accent" />
            <span className="font-display text-base tracking-wide text-accent max-sm:hidden">
              {connection?.serverName ?? 'Foxfire'}
            </span>
          </Link>

          <nav className="flex min-w-0 gap-0.5 overflow-x-auto">
            <NavLink to="/players">Players</NavLink>
            <NavLink to="/search">Search</NavLink>
            {user?.isAdmin && <NavLink to="/admin">Admin</NavLink>}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {/* The name is the way to the account page, which is where a name
                stops being a label and starts being a thing you can change. */}
            <Link
              to="/account"
              className="rounded px-2 py-1 text-sm text-text-dim transition hover:bg-surface hover:text-text max-sm:hidden"
              activeProps={{ className: 'bg-accent/10 text-accent' }}
            >
              {user?.username}
            </Link>
            <button
              onClick={() => void signOut()}
              className="rounded-md border border-hairline px-2.5 py-1 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {connection?.riotKeyRejected && (
        <div className="flex items-center gap-2 border-b border-red/30 bg-red/10 px-5 py-2 text-sm text-red">
          <Icon.Warning className="shrink-0" />
          <span>
            This server&rsquo;s Riot API key is not working, so nothing new is being fetched. Everything already
            stored still works. Its administrator needs to replace the key.
          </span>
        </div>
      )}

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
