import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { AccountRail } from '@foxfire/ui'
import { queryKeys, useClient } from '@foxfire/screens'
import { useServerHealth } from '../hooks/useKeyStatus'
import { useLcuStatus } from '../hooks/useLcuStatus'
import { useSwitchPlayer } from '../hooks/usePlayerNavigation'
import { AddAccountForm } from './AddAccountForm'

/**
 * The account rail, as this app uses it.
 *
 * The rail itself only draws. What is wired here is the desktop's: picking an
 * account navigates to it, and the League client's presence dot sits on
 * whichever account is signed in to it.
 *
 * The rest depends on where Foxfire reads from. Locally the rail is the whole of
 * account management — a typed Riot ID adds one and × removes it. On a server it
 * is only a way between your own accounts: everybody else's are a search away,
 * one becomes yours by claiming it through the League client, and giving one up
 * is Settings › Account. An × brushed on the way to an avatar is too easy a way to
 * give up a claim, and on anybody else's account the server would refuse it.
 */
export function AccountSwitcher({
  accounts,
  activeAccountId
}: {
  /** Yours: on a server the ones you have claimed, locally every one. */
  accounts: Account[]
  /** The account whose page is open, if any. */
  activeAccountId: string | null
}): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const switchPlayer = useSwitchPlayer()
  const { connected } = useServerHealth()

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
      onRemove={connected ? undefined : (id) => remove.mutate(id)}
      liveAccountId={liveAccountId}
      renderAddForm={connected ? undefined : (close) => <AddAccountForm onAdded={close} />}
    />
  )
}
