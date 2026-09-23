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
  InvitesScreen,
  LeagueAccountsScreen,
  MembersScreen,
  PlayersScreen,
  ServerDataScreen,
  createMatchRoute,
  createPlayerRoutes,
  parseSearch,
  stringifySearch,
  validatePlayersSearch
} from '@foxfire/screens'
import { AccountPage } from './pages/AccountPage'
import { AdminLayout } from './pages/AdminLayout'
import { HomePage } from './pages/HomePage'
import { UpgradeOverlay } from './pages/UpgradeOverlay'
import { WebPlayerLayout } from './pages/WebPlayerLayout'
import { WebShell } from './pages/WebShell'
import { InvitePage } from './pages/auth/InvitePage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
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

// No guard, like the invite page and for the same reason: somebody following
// one of these cannot sign in, which is the whole point of the link.
const resetPassword = createRoute({
  getParentRoute: () => root,
  path: 'reset-password/$token',
  component: ResetPasswordPage
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

const players = createRoute({
  getParentRoute: () => authed,
  path: 'players',
  validateSearch: validatePlayersSearch,
  component: PlayersScreen
})

const player = createPlayerRoutes(authed, { layout: WebPlayerLayout })

const match = createMatchRoute(authed)

const account = createRoute({ getParentRoute: () => authed, path: 'account', component: AccountPage })

const admin = createRoute({ getParentRoute: () => authed, path: 'admin', component: AdminLayout })
const adminMembers = createRoute({ getParentRoute: () => admin, path: '/', component: MembersScreen })
const adminInvites = createRoute({ getParentRoute: () => admin, path: 'invites', component: InvitesScreen })
const adminAccounts = createRoute({
  getParentRoute: () => admin,
  path: 'accounts',
  component: LeagueAccountsScreen
})
const adminData = createRoute({ getParentRoute: () => admin, path: 'data', component: ServerDataScreen })

const routeTree = root.addChildren([
  signIn,
  register,
  invite,
  resetPassword,
  authed.addChildren([
    home,
    players,
    player.player.addChildren([player.dashboard, player.champions, player.rank, player.lpEditor]),
    match,
    account,
    admin.addChildren([adminMembers, adminInvites, adminAccounts, adminData])
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
