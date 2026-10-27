import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { playerSlug } from '@foxfire/core/routes'
import { Skeleton, TftLobbyTable } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'

/**
 * A TFT row opened: everybody's board in that game, fetched when it is opened,
 * with the history's own player picked out and anybody tracked here a link to
 * their TFT profile.
 */
export function TftLobbyPanel({ account, matchId }: { account: Account; matchId: string }): JSX.Element {
  const client = useClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.tftLobby(matchId),
    queryFn: () => client.tft.lobby(account.id, matchId)
  })

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (!data) {
    return <p className="border-t border-hairline px-4 py-3 text-2xs text-text-mute">This game&apos;s lobby is not stored here.</p>
  }

  const mine = data.participants.find((p) => p.accountId === account.id)?.puuid

  return (
    <TftLobbyTable
      lobby={data}
      focusPuuid={mine}
      onOpenPlayer={(player) =>
        // The router's types are registered by each app, not here.
        void navigate({ to: '/players/$slug/tft', params: { slug: playerSlug(player) } as never })
      }
    />
  )
}
