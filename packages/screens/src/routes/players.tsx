import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, Outlet, createRoute, useParams, type AnyRoute } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { isPlayer, parsePlayerSlug, playerSlug } from '@foxfire/core/routes'
import { EmptyState, Icon, type MatchFocus } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'
import { ChampionsScreen } from '../screens/ChampionsScreen'
import { DashboardScreen } from '../screens/DashboardScreen'
import { LpEditorScreen } from '../screens/LpEditorScreen'
import { RankScreen } from '../screens/RankScreen'
import { RecordingScreen } from '../screens/RecordingScreen'
import {
  DEFAULT_RANK_RANGE,
  queueIdFrom,
  queueSearchFor,
  queueTypeFrom,
  rankQueueSearchFor,
  rankRangeSearchFor,
  validateChampionsSearch,
  validateDashboardSearch,
  validateLpEditorSearch,
  validateRankSearch,
  type ChampionsSearch,
  type DashboardSearch,
  type LpEditorSearch,
  type RankSearch
} from './params'
import { rememberSearch } from './rememberSearch'
import { useRouteSearch } from './useRouteSearch'

const PlayerContext = createContext<Account | null>(null)

/**
 * The account a player route resolved its slug to.
 *
 * Only meaningful under a player route — which is the only place anything that
 * calls it is mounted — so a missing one is a wiring mistake rather than a state
 * to render.
 */
export function usePlayer(): Account {
  const account = useContext(PlayerContext)
  if (!account) throw new Error('usePlayer() was called outside a player route')
  return account
}

export interface PlayerLayoutProps {
  /** Null while accounts load, and when the slug names nobody. */
  account: Account | null
  children: ReactNode
}

export interface PlayerRoutesOptions {
  /**
   * What surrounds every player page — the desktop's account rail. Drawn around
   * "no player by that name" as well, so that page has somewhere to go.
   */
  layout?: ComponentType<PlayerLayoutProps>
}

function Unwrapped({ children }: PlayerLayoutProps): JSX.Element {
  return <>{children}</>
}

/**
 * The player pages, under `players/$slug`: the profile and history at the index,
 * then `champions`, `rank`, `lp` and `recordings/$matchId`.
 *
 * Built once here and mounted by each app under a parent of its own, so the web
 * client and the desktop agree on every path and every search param — the same
 * ones @foxfire/core's `paths` writes, which is what the desktop's "Copy link"
 * hands out.
 *
 * Returned unassembled, so an app can mount only the pages it has and hang its
 * own beside them: the desktop leaves out `lp`, which it opens as a window, and
 * adds its live game and captures pages.
 */
export function createPlayerRoutes<TParent extends AnyRoute>(
  parent: TParent,
  options: PlayerRoutesOptions = {}
) {
  const layout = options.layout ?? Unwrapped
  // Per router rather than per module, so two routers — a test's and an app's —
  // never share what somebody last picked.
  const dashboardMemory = rememberSearch<DashboardSearch>(['queue'])
  const championsMemory = rememberSearch<ChampionsSearch>(['queue'])

  const player = createRoute({
    getParentRoute: () => parent,
    path: 'players/$slug',
    component: function PlayerRoute() {
      return <PlayerBoundary layout={layout} />
    }
  })

  const dashboard = createRoute({
    getParentRoute: () => player,
    path: '/',
    validateSearch: validateDashboardSearch,
    search: { middlewares: [dashboardMemory.middleware as never] },
    onEnter: (match) => dashboardMemory.record(match.search as DashboardSearch),
    onStay: (match) => dashboardMemory.record(match.search as DashboardSearch),
    component: DashboardRoute
  })

  const champions = createRoute({
    getParentRoute: () => player,
    path: 'champions',
    validateSearch: validateChampionsSearch,
    search: { middlewares: [championsMemory.middleware as never] },
    onEnter: (match) => championsMemory.record(match.search as ChampionsSearch),
    onStay: (match) => championsMemory.record(match.search as ChampionsSearch),
    component: ChampionsRoute
  })

  // The rank page's choices are not remembered: they have always reset on
  // leaving the page, and a period picked for one account says nothing about
  // the next.
  const rank = createRoute({
    getParentRoute: () => player,
    path: 'rank',
    validateSearch: validateRankSearch,
    component: RankRoute
  })

  const lpEditor = createRoute({
    getParentRoute: () => player,
    path: 'lp',
    validateSearch: validateLpEditorSearch,
    component: LpEditorRoute
  })

  // A recording is one player's screen, so it lives under the player: the same
  // game under somebody else's slug is their recording, or none.
  const recording = createRoute({
    getParentRoute: () => player,
    path: 'recordings/$matchId',
    component: RecordingRoute
  })

  return { player, dashboard, champions, rank, lpEditor, recording }
}

/**
 * Turns the slug into an account, and draws the page for it.
 *
 * The children are keyed by account so every page starts fresh for a different
 * player — an expanded row or a half-typed draft belongs to whoever it was
 * typed against.
 */
function PlayerBoundary({ layout: Layout }: { layout: ComponentType<PlayerLayoutProps> }): JSX.Element {
  const client = useClient()
  const { slug } = useParams({ strict: false }) as { slug?: string }

  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
  })

  const riotId = slug === undefined ? null : parsePlayerSlug(slug)
  const account = (riotId && accounts.data?.find((a) => isPlayer(a, riotId))) || null

  // Whom this page was showing. A sync that notices a rename changes the Riot
  // ID under an open page, and the slug with it; following the account there is
  // better than announcing that the player has vanished.
  const shown = useRef<Account | null>(null)
  useEffect(() => {
    if (account) shown.current = account
  }, [account])

  if (accounts.isPending) return <Layout account={null}>{null}</Layout>

  if (accounts.isError) {
    return (
      <Layout account={null}>
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="Could not load accounts"
          description={accounts.error instanceof Error ? accounts.error.message : undefined}
        />
      </Layout>
    )
  }

  if (!account) {
    const renamed = shown.current && accounts.data.find((a) => a.id === shown.current?.id)
    if (renamed) {
      return <Navigate to="." params={{ slug: playerSlug(renamed) } as never} replace />
    }

    return (
      <Layout account={null}>
        <EmptyState
          icon={<Icon.Search />}
          title="No player by that name"
          description={
            riotId
              ? `Nobody here plays as ${riotId.gameName}#${riotId.tagLine}. If they changed their Riot ID, look for them under the new one.`
              : 'This link does not name a Riot ID.'
          }
        />
      </Layout>
    )
  }

  return (
    <Layout account={account}>
      <PlayerContext.Provider value={account}>
        <Outlet key={account.id} />
      </PlayerContext.Provider>
    </Layout>
  )
}

function DashboardRoute(): JSX.Element {
  const account = usePlayer()
  const [search, setSearch] = useRouteSearch<DashboardSearch>()
  const [focus, setFocus] = useState<MatchFocus | null>(null)

  // A game somebody asked for from elsewhere — a recording window's "show
  // match". Opened, then taken back out of the URL: asking for the same game a
  // second time has to be a navigation that changes something, or it would
  // land on the address the page is already at and do nothing.
  useEffect(() => {
    if (search.match === undefined) return
    setFocus({ matchId: search.match })
    setSearch({ match: undefined }, { replace: true })
  }, [search.match, setSearch])

  return (
    <DashboardScreen
      account={account}
      queueId={queueIdFrom(search.queue)}
      onQueueChange={(queueId) => setSearch({ queue: queueSearchFor(queueId) })}
      focus={focus}
    />
  )
}

function ChampionsRoute(): JSX.Element {
  const account = usePlayer()
  const [search, setSearch] = useRouteSearch<ChampionsSearch>()

  return (
    <ChampionsScreen
      account={account}
      queueId={queueIdFrom(search.queue)}
      onQueueChange={(queueId) => setSearch({ queue: queueSearchFor(queueId) })}
      range={search.range ?? null}
      onRangeChange={(range) => setSearch({ range })}
    />
  )
}

function RankRoute(): JSX.Element {
  const account = usePlayer()
  const [search, setSearch] = useRouteSearch<RankSearch>()

  return (
    <RankScreen
      account={account}
      queueType={queueTypeFrom(search.queue)}
      onQueueTypeChange={(queueType) => setSearch({ queue: rankQueueSearchFor(queueType) })}
      range={search.range ?? DEFAULT_RANK_RANGE}
      onRangeChange={(range) => setSearch({ range: rankRangeSearchFor(range) })}
    />
  )
}

function RecordingRoute(): JSX.Element {
  const account = usePlayer()
  const { matchId } = useParams({ strict: false }) as { matchId: string }

  return (
    <RecordingScreen
      account={account}
      matchId={matchId}
      back={
        <Link
          to="/players/$slug"
          params={{ slug: playerSlug(account) }}
          search={{ match: matchId } as never}
          className="inline-flex items-center gap-1.5 text-sm text-text-dim transition hover:text-accent"
        >
          <Icon.ChevronDown width={14} height={14} className="rotate-90" />
          {account.gameName}&rsquo;s history
        </Link>
      }
    />
  )
}

function LpEditorRoute(): JSX.Element {
  const account = usePlayer()
  const [search] = useRouteSearch<LpEditorSearch>()

  return (
    <LpEditorScreen
      accountId={account.id}
      queueType={queueTypeFrom(search.queue)}
      focusMatchId={search.match ?? null}
    />
  )
}
