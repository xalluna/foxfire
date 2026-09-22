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

  // On a phone the scoreboard keeps its columns and scrolls sideways on its own.
  return (
    <div className="max-md:overflow-x-auto">
      <div className="max-md:min-w-[720px]">
        <MatchDetailTable detail={data} loading={isLoading} trackedPuuid={trackedPuuid} />
      </div>
    </div>
  )
}
