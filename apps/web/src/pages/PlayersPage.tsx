import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { playerSlug } from '@foxfire/core/routes'
import { Asset, EmptyState, Icon, MatchListSkeleton, profileIconUrl, useAssetManifest } from '@foxfire/ui'
import { queryKeys, useClient, useConnection } from '@foxfire/screens'

function PlayerRow({
  account,
  onSetHome
}: {
  account: Account
  onSetHome: (account: Account) => void
}): JSX.Element {
  const assets = useAssetManifest()

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 max-md:px-3">
      <Link to="/players/$slug" params={{ slug: playerSlug(account) }} className="flex min-w-0 flex-1 items-center gap-3">
        <Asset
          src={assets ? profileIconUrl(assets, account.profileIconId) : null}
          className="h-10 w-10 shrink-0 border border-hairline"
          rounded="rounded-md"
        />
        <div className="min-w-0">
          <p className="truncate text-base text-text">
            {account.gameName}
            <span className="text-text-mute">#{account.tagLine}</span>
          </p>
          <p className="truncate text-2xs text-text-mute">
            {account.ownerUsername ? `Claimed by ${account.ownerUsername}` : 'Not claimed yet'}
            {account.summonerLevel !== null && ` · Level ${account.summonerLevel}`}
          </p>
        </div>
      </Link>

      <button
        onClick={() => onSetHome(account)}
        disabled={account.isHomeAccount}
        title={account.isHomeAccount ? 'This browser opens on this account' : 'Open on this account in this browser'}
        className="shrink-0 rounded-md p-1.5 text-text-mute transition hover:text-accent disabled:text-accent"
      >
        <Icon.Star width={15} height={15} fill={account.isHomeAccount ? 'currentColor' : 'none'} />
      </button>
    </li>
  )
}

/**
 * Everybody this server keeps history for, yours first.
 *
 * Also the page for somebody who has claimed nothing yet, which is where it
 * says how: a League account is claimed from the desktop app, with the League
 * client running, because the client is what vouches that it is yours.
 */
export function PlayersPage(): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const connection = useConnection()

  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
  })

  const setHome = useMutation({
    mutationFn: (account: Account) => client.accounts.setHome(account.id),
    onSuccess: (list) => queryClient.setQueryData(queryKeys.accounts(), list)
  })

  const list = accounts.data ?? []
  const mine = list.filter((a) => a.isMine !== false)
  const others = list.filter((a) => a.isMine === false)

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 max-md:p-2">
      <div>
        <h1 className="font-display text-xl text-text">Players</h1>
        <p className="mt-0.5 text-sm text-text-mute">
          Everybody {connection?.serverName ?? 'this server'} keeps match history for. Pick anyone to see their games.
        </p>
      </div>

      {accounts.isPending ? (
        <MatchListSkeleton rows={4} />
      ) : (
        <>
          <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
            <p className="border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
              Yours
            </p>
            {mine.length === 0 ? (
              <EmptyState
                icon={<Icon.Plus />}
                title="No League account of yours yet"
                description="Claim yours from Foxfire desktop, with the League client open and signed in — the client is what vouches that the account is yours. It shows up here as soon as it is claimed."
              />
            ) : (
              <ul className="divide-y divide-hairline/60">
                {mine.map((account) => (
                  <PlayerRow key={account.id} account={account} onSetHome={(a) => setHome.mutate(a)} />
                ))}
              </ul>
            )}
          </section>

          {others.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
              <p className="border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
                Everybody else
              </p>
              <ul className="divide-y divide-hairline/60">
                {others.map((account) => (
                  <PlayerRow key={account.id} account={account} onSetHome={(a) => setHome.mutate(a)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
