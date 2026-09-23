import {
  Navigate,
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  useParams,
  type ErrorComponentProps
} from '@tanstack/react-router'
import {
  PlayersScreen,
  createPlayerRoutes,
  parseSearch,
  stringifySearch,
  usePlayer,
  validatePlayersSearch
} from '@foxfire/screens'
import { AppShell } from './App'
import { Main, PlayerLayout } from './components/PlayerLayout'
import { validateLpEditorWindowSearch } from './lpEditor/search'
import { Captures } from './views/Captures'
import { Home } from './views/Home'
import { LiveGame } from './views/LiveGame'
import { Settings } from './views/Settings'

/*
 * Every window this app opens, as one route table.
 *
 * The main window is `_app`: the header, the nav and the banners, around the
 * player pages shared with the web client plus the desktop's own. The other
 * windows — telemetry, the archive manager, a recording, the LP editor — are
 * `_window` routes, drawn with nothing around them. Each is a BrowserWindow
 * loading this same bundle at its own address (main/rendererUrl.ts), so there is
 * no second Vite entry point to keep in step, and the lazy components mean no
 * window downloads or parses a panel it is not showing.
 *
 * Hash history, because a packaged renderer is a file:// page, where a path
 * would name a file on disk rather than a route.
 */

const root = createRootRoute({ component: Outlet })

const app = createRoute({ getParentRoute: () => root, id: '_app', component: AppShell })

const home = createRoute({ getParentRoute: () => app, path: '/', component: Home })

const players = createPlayerRoutes(app, { layout: PlayerLayout })

const live = createRoute({
  getParentRoute: () => players.player,
  path: 'live',
  component: function LiveRoute() {
    return <LiveGame account={usePlayer()} />
  }
})

const captures = createRoute({
  getParentRoute: () => players.player,
  path: 'captures',
  component: function CapturesRoute() {
    return <Captures account={usePlayer()} />
  }
})

/**
 * The finder, which the web client reaches as its Players page.
 *
 * Kept under "Search" here because that is the word for it in an app whose nav
 * is otherwise one account's own pages — there is no list of everybody to fold
 * it into, the way a browser has.
 */
const search = createRoute({
  getParentRoute: () => app,
  path: 'search',
  validateSearch: validatePlayersSearch,
  component: function SearchRoute() {
    return (
      <Main>
        <PlayersScreen heading="Search" />
      </Main>
    )
  }
})

const settings = createRoute({
  getParentRoute: () => app,
  path: 'settings/{-$category}',
  component: function SettingsRoute() {
    const { category } = useParams({ strict: false })
    return (
      <Main>
        <Settings category={category} />
      </Main>
    )
  }
})

const windows = createRoute({ getParentRoute: () => root, id: '_window', component: Outlet })

const telemetry = createRoute({
  getParentRoute: () => windows,
  path: 'telemetry',
  component: lazyRouteComponent(() => import('./telemetry/TelemetryApp'), 'TelemetryApp')
})

const archives = createRoute({
  getParentRoute: () => windows,
  path: 'archives',
  component: lazyRouteComponent(() => import('./archives/ArchivesApp'), 'ArchivesApp')
})

const recording = createRoute({
  getParentRoute: () => windows,
  path: 'recording/$id',
  component: lazyRouteComponent(() => import('./recording/RecordingApp'), 'RecordingApp')
})

/** A recording with no file on this machine, played from YouTube. See windowRoutes.remoteRecording. */
const remoteRecording = createRoute({
  getParentRoute: () => windows,
  path: 'recording/match/$accountId/$matchId',
  component: lazyRouteComponent(() => import('./recording/RemoteRecordingApp'), 'RemoteRecordingApp')
})

/**
 * The LP editor's window. Its own route rather than the shared `lp` page, which
 * sits under a player and so under the main window's header; the window is
 * opened with an account id by the main process, which has no slugs.
 */
const lpEditor = createRoute({
  getParentRoute: () => windows,
  path: 'lp-editor',
  validateSearch: validateLpEditorWindowSearch,
  component: lazyRouteComponent(() => import('./lpEditor/LpEditorWindow'), 'LpEditorWindow')
})

const routeTree = root.addChildren([
  app.addChildren([
    home,
    players.player.addChildren([players.dashboard, players.champions, players.rank, live, captures]),
    search,
    settings
  ]),
  windows.addChildren([telemetry, archives, recording, remoteRecording, lpEditor])
])

/**
 * Render errors go to the ErrorBoundary around the whole tree, as they did
 * before there was a router: it reports to the app log, and "Something broke"
 * with a reload button is the honest answer to a bug.
 */
function RethrowError({ error }: ErrorComponentProps): JSX.Element {
  throw error
}

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  parseSearch,
  stringifySearch,
  defaultErrorComponent: RethrowError,
  // Every address this app opens is one of the routes above, so one that
  // matches nothing is stale — a hash from an older build, restored by a dev
  // server reload — and the main window's home is the useful place to land.
  defaultNotFoundComponent: () => <Navigate to="/" replace />
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
