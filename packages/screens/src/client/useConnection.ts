import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectionState, GameId } from '@foxfire/core'
import { useClient } from './context'
import { queryKeys } from '../queries/keys'

/**
 * Where the data is coming from, kept live.
 *
 * Read once and then followed, so every screen asking agrees without each one
 * holding its own copy — the connection used to be read by three components
 * separately, each with its own request.
 */
export function useConnection(): ConnectionState | undefined {
  const client = useClient()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: queryKeys.connection(),
    queryFn: () => client.connection.get(),
    staleTime: Infinity
  })

  useEffect(
    () =>
      client.connection.onChanged((state) => {
        queryClient.setQueryData(queryKeys.connection(), state)
      }),
    [client, queryClient]
  )

  return data
}

/**
 * The games on offer here, League first — League alone on a server whose host
 * has not turned TFT on. Undefined until the connection has been read, which
 * a screen that would otherwise send somebody elsewhere has to wait out.
 */
export function useGames(): readonly GameId[] | undefined {
  return useConnection()?.games
}

/** Whether one game is on offer here, or undefined until that is known. */
export function useOffersGame(game: GameId): boolean | undefined {
  const games = useGames()
  return games === undefined ? undefined : games.includes(game)
}

/** Whether the person signed in administers the server answering. */
export function useIsServerAdmin(): boolean {
  return useConnection()?.session?.isAdmin ?? false
}

/**
 * Whether they are a head admin there: the import, LP on anybody's games, and
 * acting against another admin. What is allowed is still the server's to say.
 */
export function useIsHeadAdmin(): boolean {
  return useConnection()?.session?.isHeadAdmin ?? false
}

/**
 * Who is reading, as far as what a screen offers goes.
 *
 * An outsider is somebody on a server with nobody signed in: a visitor to an
 * open server, or whoever was handed a share link. The server only answers
 * them reads, so a screen offers them nothing that writes — no sync, no LP, no
 * share — rather than buttons that end in a refusal. Never true on the
 * desktop, which only ever reads a server signed in.
 *
 * `viaLink` is an outsider on a server that is not open, who can only be here
 * on a share link, and so can read one profile and nothing around it — not the
 * finder, not their own accounts, not anybody else's.
 */
export function useViewer(): { outsider: boolean; publicAccess: boolean; viaLink: boolean } {
  const connection = useConnection()
  const outsider = connection?.mode === 'server' && connection.session === null
  const publicAccess = connection?.publicAccess ?? false

  return { outsider, publicAccess, viaLink: outsider && !publicAccess }
}
