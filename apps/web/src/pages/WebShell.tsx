import { useEffect, type ReactNode } from 'react'
import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { Icon, Logo } from '@foxfire/ui'
import { PlayerSearchBox, useConnection } from '@foxfire/screens'
import { canBrowse, signOut, useAuth } from '../session/session'
import { EmailBanner } from './EmailBanner'

function NavLink({ to, children }: { to: '/admin'; children: ReactNode }): JSX.Element {
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
 * Everything around a page: the server's name, where to go, finding somebody,
 * who you are — or, for somebody reading without an account, the way to sign
 * in.
 *
 * Also where a session that ends underneath the page is noticed — revoked by an
 * admin, signed out in another tab, expired — and turned into the sign-in page,
 * with the way back to where it was. Unless the page is one they may still
 * read signed out, and then it simply stays — or they were reading on a share
 * link that has just stopped working, and then they are told that instead.
 */
export function WebShell(): JSX.Element {
  const user = useAuth((s) => s.user)
  const browsable = useAuth(canBrowse)
  const linkEnded = useAuth((s) => s.shareRefused !== null)
  const publicAccess = useAuth((s) => s.publicAccess)
  const connection = useConnection()
  const router = useRouter()

  // Read where this page is at the moment the session ends, not as a
  // dependency: this layout stays mounted while the navigation to sign-in is
  // under way, and following the address would send it again from the
  // sign-in page itself, a redirect inside a redirect.
  useEffect(() => {
    if (user || browsable) return
    const { href, pathname } = router.state.location
    if (pathname === '/sign-in' || pathname === '/shared-link') return
    if (linkEnded) {
      void router.navigate({ to: '/shared-link', replace: true })
      return
    }
    void router.navigate({ to: '/sign-in', search: { redirect: href }, replace: true })
  }, [user, browsable, linkEnded, router])

  // Where "Sign in" comes back to: the page being read when it was pressed.
  const here = useRouterState({ select: (state) => state.location.href })

  return (
    <div className="min-h-screen bg-canvas text-text">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/95 backdrop-blur">
        {/* As wide as the widest page below it — see WebPlayerLayout. */}
        {/*
          Three columns, the outer two growing equally from nothing, so the
          search box sits in the middle of the header for as long as neither
          side needs more than half of what is left beside it. The sides do not
          wrap, which is what makes their width a floor the box gives way to —
          a server name that could wrap would let the box cover the nav.
        */}
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-4 max-md:gap-2 max-md:px-2">
          <div className="flex flex-1 basis-0 items-center gap-4 whitespace-nowrap max-md:gap-2">
            <Link to="/" className="flex shrink-0 items-center gap-2">
              <Logo className="shrink-0 text-accent" />
              <span className="font-display text-base tracking-wide text-accent max-sm:hidden">
                {connection?.serverName ?? 'Foxfire'}
              </span>
            </Link>

            {user?.isAdmin && (
              <nav className="flex gap-0.5">
                <NavLink to="/admin">Admin</NavLink>
              </nav>
            )}
          </div>

          {/* The finder is the way to everybody, which somebody on a share
              link was not given: theirs is one profile. */}
          {user || publicAccess ? (
            <PlayerSearchBox className="w-full min-w-0 max-w-[360px]" />
          ) : (
            <div className="w-full min-w-0 max-w-[360px]" />
          )}

          <div className="flex flex-1 basis-0 items-center justify-end gap-3 whitespace-nowrap">
            {user ? (
              <>
                {/* The name is the way to the account page, which is where a name
                    stops being a label and starts being a thing you can change. */}
                <Link
                  to="/account"
                  className="rounded px-2 py-1 text-sm text-text-dim transition hover:bg-surface hover:text-text max-sm:hidden"
                  activeProps={{ className: 'bg-accent/10 text-accent' }}
                >
                  {user.username}
                </Link>
                <button
                  onClick={() => void signOut()}
                  className="shrink-0 whitespace-nowrap rounded-md border border-edge px-2.5 py-1 text-sm text-text-dim transition hover:border-accent hover:text-accent"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/sign-in"
                search={{ redirect: here }}
                className="shrink-0 whitespace-nowrap rounded-md border border-edge px-2.5 py-1 text-sm text-text-dim transition hover:border-accent hover:text-accent"
              >
                Sign in
              </Link>
            )}
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

      <EmailBanner />

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
