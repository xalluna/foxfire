import { useQuery } from '@tanstack/react-query'
import { MatchDetailTable } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'

/** The expanded scoreboard for one game, fetched when a row is opened. */
export function MatchDetailPanel({
  matchId,
  trackedPuuid
}: {
  matchId: string
  /** Whose view this is: their row is picked out of the ten. */
  trackedPuuid: string | null
}): JSX.Element {
  const client = useClient()
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.matchDetail(matchId),
    queryFn: () => client.dashboard.matchDetail(matchId)
  })

  return <MatchDetailTable detail={data} loading={isLoading} trackedPuuid={trackedPuuid} />
}
