import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Account } from '@foxfire/core'
import { AccountRail } from '@foxfire/ui'
import { queryKeys, useClient } from '@foxfire/screens'
import { useLcuStatus } from '../hooks/useLcuStatus'
import { useUiStore } from '../store/uiStore'
import { AddAccountForm } from './AddAccountForm'

/**
 * The account rail, as this app uses it.
 *
 * The rail itself only draws. What is wired here is the desktop's: which
 * account is selected, the League client's presence dot on whichever account
 * is signed in to it, and the form for adding one — a typed Riot ID locally,
 * an instruction to use the client on a server.
 */
export function AccountSwitcher({ accounts }: { accounts: Account[] }): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()

  const activeAccountId = useUiStore((s) => s.activeAccountId)
  const setActiveAccount = useUiStore((s) => s.setActiveAccount)

  const lcuStatus = useLcuStatus()
  const liveAccountId = lcuStatus.state === 'connected' ? lcuStatus.accountId : null

  const setHome = useMutation({
    mutationFn: (id: string) => client.accounts.setHome(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
  })

  const remove = useMutation({
    mutationFn: (id: string) => client.accounts.remove(id),
    onSuccess: (remaining) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      setActiveAccount(remaining.length > 0 ? remaining[0].id : null)
    }
  })

  return (
    <AccountRail
      accounts={accounts}
      activeAccountId={activeAccountId}
      onSelect={setActiveAccount}
      onSetHome={(id) => setHome.mutate(id)}
      onRemove={(id) => remove.mutate(id)}
      liveAccountId={liveAccountId}
      renderAddForm={(close) => <AddAccountForm onAdded={close} />}
    />
  )
}
