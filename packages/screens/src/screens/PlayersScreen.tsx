import { useEffect, useState, type ComponentProps } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { playerSlug } from '@foxfire/core/routes'
import { PlayersPage, type PlayerLink } from '@foxfire/ui'
import { useClient } from '../client/context'
import { useConnection } from '../client/useConnection'
import { queryKeys } from '../queries/keys'
import { useRouteSearch } from '../routes/useRouteSearch'
import type { PlayersSearch } from '../routes/params'

/**
 * A row's link into the player pages.
 *
 * Declared at module scope rather than inside the screen. A component rebuilt
 * on every render is a new type each time, and React would tear down and
 * rebuild every row in the list on each keystroke.
 */
function PlayerRowLink({ account, className, children }: ComponentProps<PlayerLink>): JSX.Element {
  return (
    <Link to="/players/$slug" params={{ slug: playerSlug(account) }} className={className}>
      {children}
    </Link>
  )
}

/**
 * How long the box waits before asking.
 *
 * The finder queries as somebody types, and a request per keystroke would spend
 * a name's worth of the server's per-address search allowance on one name. Long
 * enough to swallow a typed word, short enough not to feel like waiting.
 */
const TYPING_PAUSE_MS = 250

/** A value that stops changing until it has been still for a moment. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])

  return settled
}

/**
 * Finding somebody this server tracks.
 *
 * The web client mounts this as its Players page and the desktop as its Search
 * page — one screen under the word that fits each app, because they ask the
 * same question. It is answered out of the server's own tables: no Riot call,
 * and every row leads to a dashboard that already knows what each game was
 * worth to that account.
 *
 * A query rather than a mutation, which is what search used to be. Its result
 * lived nowhere, so leaving the page threw it away and typing the same name
 * twice paid for it twice.
 *
 * The query lives in the URL so a filtered list can be linked to, and is
 * written with `replace` — a name is typed one letter at a time, and each one
 * should not be a place the back button goes.
 */
export function PlayersScreen({ heading }: { heading?: string } = {}): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const connection = useConnection()
  const [search, setSearch] = useRouteSearch<PlayersSearch>()

  const query = search.q ?? ''
  const asked = useDebounced(query, TYPING_PAUSE_MS)

  const players = useQuery({
    queryKey: queryKeys.playerSearch(asked),
    queryFn: () => client.search.players(asked),
    // Keeps the previous answer on screen while the next one is fetched, so the
    // list holds still rather than collapsing to a skeleton mid-word.
    placeholderData: keepPreviousData
  })

  // Which account this machine opens on is a property of the whole list, not of
  // whatever the finder is currently narrowed to — read from the list that
  // every other screen already has warm.
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
  })

  const setHome = useMutation({
    mutationFn: (account: Account) => client.accounts.setHome(account.id),
    onSuccess: (list) => queryClient.setQueryData(queryKeys.accounts(), list)
  })

  // Local-only mode has no server and no community — the accounts are the ones
  // on this PC, and saying otherwise would be describing somebody else's setup.
  const intro =
    connection?.mode === 'local'
      ? 'Every League account on this PC. Pick one to see its games.'
      : `Everybody ${connection?.serverName ?? 'this server'} keeps match history for. Pick anyone to see their games.`

  return (
    <PlayersPage
      heading={heading}
      intro={intro}
      query={query}
      onQueryChange={(next) => setSearch({ q: next || undefined }, { replace: true })}
      players={players.data ?? []}
      loading={players.isPending}
      homeAccountId={accounts.data?.find((a) => a.isHomeAccount)?.id ?? null}
      onSetHome={(account) => setHome.mutate(account)}
      link={PlayerRowLink}
    />
  )
}
