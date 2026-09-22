import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { AccountRail } from '@foxfire/ui'
import { queryKeys, useClient } from '@foxfire/screens'
import { useLcuStatus } from '../hooks/useLcuStatus'
import { useSwitchPlayer } from '../hooks/usePlayerNavigation'
import { AddAccountForm } from './AddAccountForm'

/**
 * The account rail, as this app uses it.
 *
 * The rail itself only draws. What is wired here is the desktop's: picking an
 * account navigates to it, the League client's presence dot sits on whichever
 * account is signed in to it, and the form for adding one — a typed Riot ID
 * locally, an instruction to use the client on a server.
 */
export function AccountSwitcher({
  accounts,
  activeAccountId
}: {
  accounts: Account[]
  /** The account whose page is open, if any. */
  activeAccountId: string | null
}): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const switchPlayer = useSwitchPlayer()

  const lcuStatus = useLcuStatus()
  const liveAccountId = lcuStatus.state === 'connected' ? lcuStatus.accountId : null

  const setHome = useMutation({
    mutationFn: (id: string) => client.accounts.setHome(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
  })

  const remove = useMutation({
    mutationFn: (id: string) => client.accounts.remove(id),
    onSuccess: async (remaining, removedId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      // Removing an account from beside somebody else's page leaves that page
      // alone. Removing the one on screen moves to whoever is left.
      if (removedId !== activeAccountId) return
      if (remaining.length > 0) switchPlayer(remaining[0])
      else void navigate({ to: '/' })
    }
  })

  return (
    <AccountRail
      accounts={accounts}
      activeAccountId={activeAccountId}
      onSelect={(id) => {
        const account = accounts.find((a) => a.id === id)
        if (account) switchPlayer(account)
      }}
      onSetHome={(id) => setHome.mutate(id)}
      onRemove={(id) => remove.mutate(id)}
      liveAccountId={liveAccountId}
      renderAddForm={(close) => <AddAccountForm onAdded={close} />}
    />
  )
}
