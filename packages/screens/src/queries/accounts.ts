import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Account, RiotIdInput } from '@foxfire/core'
import { useClient } from '../client/context'
import { queryKeys } from './keys'

/**
 * The account reads every screen shares, one question each.
 *
 * Each is its own cache entry under `queryKeys.accounts()`, so a screen asks
 * only what it needs — the rail your accounts, a player page the one its link
 * names — and a link, an unlink or a new home refreshes them all at once.
 */

/** Yours, with the home one marked. On a server, the ones you have claimed. */
export function useMyAccounts(): UseQueryResult<Account[]> {
  const client = useClient()
  return useQuery({ queryKey: queryKeys.myAccounts(), queryFn: () => client.accounts.mine() })
}

/** The account this machine or browser opens on, which may be somebody else's. */
export function useHomeAccount(): UseQueryResult<Account | null> {
  const client = useClient()
  return useQuery({ queryKey: queryKeys.homeAccount(), queryFn: () => client.accounts.getHome() })
}

/** One account by id. Waits, rather than asking, while there is no id. */
export function useAccount(accountId: string | null): UseQueryResult<Account | null> {
  const client = useClient()
  return useQuery({
    queryKey: queryKeys.account(accountId ?? ''),
    queryFn: () => client.accounts.get(accountId!),
    enabled: accountId !== null
  })
}

/** One account by Riot ID. Waits, rather than asking, while there is no Riot ID. */
export function useAccountByRiotId(riotId: RiotIdInput | null): UseQueryResult<Account | null> {
  const client = useClient()
  return useQuery({
    queryKey: queryKeys.accountByRiotId(riotId ?? { gameName: '', tagLine: '' }),
    queryFn: () => client.accounts.find(riotId!),
    enabled: riotId !== null
  })
}
