import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type ErrorComponentProps
} from '@tanstack/react-router'
import { EmptyState, Icon } from '@foxfire/ui'
import {
  SearchScreen,
  ServerDataScreen,
  ServerManagementScreen,
  createMatchRoute,
  createPlayerRoutes,
  parseSearch,
  stringifySearch
} from '@foxfire/screens'
import { AdminLayout } from './pages/AdminLayout'
import { HomePage } from './pages/HomePage'
import { PlayersPage } from './pages/PlayersPage'
import { UpgradeOverlay } from './pages/UpgradeOverlay'
import { WebPlayerLayout } from './pages/WebPlayerLayout'
import { WebShell } from './pages/WebShell'
import { InvitePage } from './pages/auth/InvitePage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { SignInPage } from './pages/auth/SignInPage'
import { safeRedirect } from './routes/redirect'
import { useAuth } from './session/session'

/*
 * Every page of the web client.
 *
 * Three are for somebody not signed in — signing in, registering, and an
 * invite — and everything else sits behind `_authed`, which sends anybody else
 * to sign in and back again after. Sharing is for members only: a link to a
 * profile or a game asks whoever opens it to sign in first.
 *
 * The player pages and the match page come from @foxfire/screens, the same
 * routes the desktop builds its "Copy link" addresses against.
 */

function RootLayout(): JSX.Element {
  return (
    <>
      <Outlet />
      <UpgradeOverlay />
    </>
  )
}

const root = createRootRoute({ component: RootLayout })

const signedIn = (): boolean => useAuth.getState().user !== null

const signIn = createRoute({
  getParentRoute: () => root,
  path: 'sign-in',
  validateSearch: (raw: Record<string, unknown>): { redirect?: string } =>
    typeof raw.redirect === 'string' ? { redirect: raw.redirect } : {},
  beforeLoad: ({ search }) => {
    if (signedIn()) throw redirect({ href: safeRedirect(search.redirect), replace: true })
  },
  component: SignInPage
})

const register = createRoute({
  getParentRoute: () => root,
  path: 'register',
  beforeLoad: () => {
    if (signedIn()) throw redirect({ to: '/', replace: true })
  },
  component: RegisterPage
})

const invite = createRoute({
  getParentRoute: () => root,
  path: 'invite/$token',
  component: InvitePage
})

const authed = createRoute({
  getParentRoute: () => root,
  id: '_authed',
  beforeLoad: ({ location }) => {
    if (!signedIn()) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href }, replace: true })
    }
  },
  component: WebShell
})

const home = createRoute({ getParentRoute: () => authed, path: '/', component: HomePage })

const players = createRoute({ getParentRoute: () => authed, path: 'players', component: PlayersPage })

const player = createPlayerRoutes(authed, { layout: WebPlayerLayout })

const match = createMatchRoute(authed)

// Unwrapped: SearchPage sets its own width, and has to — see the note there.
const search = createRoute({ getParentRoute: () => authed, path: 'search', component: SearchScreen })

const admin = createRoute({ getParentRoute: () => authed, path: 'admin', component: AdminLayout })
const adminMembers = createRoute({ getParentRoute: () => admin, path: '/', component: ServerManagementScreen })
const adminData = createRoute({ getParentRoute: () => admin, path: 'data', component: ServerDataScreen })

const routeTree = root.addChildren([
  signIn,
  register,
  invite,
  authed.addChildren([
    home,
    players,
    player.player.addChildren([player.dashboard, player.champions, player.rank, player.lpEditor]),
    match,
    search,
    admin.addChildren([adminMembers, adminData])
  ])
])

function NotFound(): JSX.Element {
  return (
    <EmptyState
      icon={<Icon.Search />}
      title="Nothing here"
      description="This address is not a page of this server. It may be from an older link."
    />
  )
}

function RouteError({ error }: ErrorComponentProps): JSX.Element {
  return (
    <EmptyState
      icon={<Icon.Warning />}
      tone="error"
      title="Something broke"
      description={error instanceof Error ? error.message : 'Reloading the page usually clears it.'}
    />
  )
}

export function createWebRouter() {
  return createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    // A page's scroll position is the window's here, unlike the desktop's
    // panes, so moving to a new page starts at its top.
    scrollRestoration: true
  })
}

export type WebRouter = ReturnType<typeof createWebRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: WebRouter
  }
}
