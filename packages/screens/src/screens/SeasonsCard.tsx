import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GAMES, type GameId } from '@foxfire/core'
import { Segmented, SeasonsEditor } from '@foxfire/ui'
import { useClient } from '../client/context'
import { useGames } from '../client/useConnection'
import { invalidationsFor } from '../queries/invalidations'
import { queryKeys } from '../queries/keys'

/**
 * The ranked season boundaries, entered by hand.
 *
 * A card rather than a page because where it lives differs: beside rank
 * tracking on the desktop, among a server's admin pages in a browser. On a
 * server only an admin may save one, and the server is the one that says so.
 *
 * One game's list at a time, picked at the top: League's seasons and TFT's sets
 * start on different days, and saving one never touches the other. No picker
 * where League is the only game on offer — a server whose host has not turned
 * TFT on has no sets to keep.
 */
export function SeasonsCard(): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const offered = useGames() ?? ['lol']
  const [picked, setGame] = useState<GameId>('lol')
  const game = offered.includes(picked) ? picked : 'lol'

  const seasons = useQuery({
    queryKey: queryKeys.seasons(game),
    queryFn: () => client.seasons.list(game)
  })

  return (
    <SeasonsEditor
      // A draft belongs to the list it was typed against; switching games
      // starts the other list fresh rather than carrying rows across.
      key={game}
      game={game}
      picker={
        offered.length > 1 ? (
          <Segmented
            options={offered.map((id): [GameId, string] => [id, GAMES[id].shortName])}
            value={game}
            onChange={setGame}
            size="sm"
          />
        ) : undefined
      }
      seasons={seasons.data}
      onSave={async (next) => {
        const saved = await client.seasons.save(next, game)
        queryClient.setQueryData(queryKeys.seasons(game), saved)
        for (const queryKey of invalidationsFor({ kind: 'seasonsSaved' })) {
          void queryClient.invalidateQueries({ queryKey })
        }
        return saved
      }}
    />
  )
}
