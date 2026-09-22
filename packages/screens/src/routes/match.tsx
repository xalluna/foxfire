import { createRoute, useParams, type AnyRoute } from '@tanstack/react-router'
import { MatchScreen } from '../screens/MatchScreen'
import { validateMatchSearch, type MatchSearch } from './params'
import { useRouteSearch } from './useRouteSearch'

/**
 * One game on a page of its own, at `matches/$matchId?player=<slug>` — the
 * address @foxfire/core's `paths.match` writes, and so the one the desktop's
 * "Copy link" on a match row hands out.
 */
export function createMatchRoute<TParent extends AnyRoute>(parent: TParent) {
  return createRoute({
    getParentRoute: () => parent,
    path: 'matches/$matchId',
    validateSearch: validateMatchSearch,
    component: MatchRoute
  })
}

function MatchRoute(): JSX.Element {
  const { matchId } = useParams({ strict: false }) as { matchId?: string }
  const [search] = useRouteSearch<MatchSearch>()

  return <MatchScreen matchId={matchId ?? ''} player={search.player} />
}
