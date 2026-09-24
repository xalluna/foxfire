import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Account } from '@foxfire/core'
import { SettingsRow, ghostButtonClass } from '@foxfire/ui'
import { queryKeys, useClient, useMyAccounts } from '@foxfire/screens'

/**
 * The League accounts linked to you on this server, each with a way to give it up.
 *
 * Here rather than on the rail. Unlinking is a decision about your account on a
 * server — the history stays, but whoever signs in to it next can claim it — and
 * a row in Settings is where that belongs, not an × one stray click from the
 * avatar beside it. An admin unlinks anybody's from League accounts; this is
 * the half that needs no admin.
 */
export function LinkedAccountRows(): JSX.Element {
  // The rail's query, so an unlink here takes the account off the rail too.
  const accounts = useMyAccounts()
  const yours = accounts.data ?? []

  return (
    <>
      {yours.map((account) => (
        <LinkedAccountRow key={account.id} account={account} />
      ))}
    </>
  )
}

function LinkedAccountRow({ account }: { account: Account }): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const riotId = `${account.gameName}#${account.tagLine}`

  const unlink = useMutation({
    mutationFn: () => client.accounts.remove(account.id),
    // Awaited, so the button reads "Unlinking…" until the row has actually gone
    // rather than flicking back to "Unlink" for the length of a refetch.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        // Search shows who has claimed each account.
        queryClient.invalidateQueries({ queryKey: queryKeys.playerSearches() })
      ])
  })

  return (
    <SettingsRow
      label={riotId}
      description={unlink.error?.message ?? 'Linked to you. Its games and rank are yours to edit.'}
      control={
        <button
          type="button"
          disabled={unlink.isPending}
          className={ghostButtonClass}
          onClick={() => {
            if (
              confirm(
                `Unlink ${riotId}? Its games stay on this server, but it stops being yours — whoever signs in to it in the League client next can claim it.`
              )
            ) {
              unlink.mutate()
            }
          }}
        >
          {unlink.isPending ? 'Unlinking…' : 'Unlink'}
        </button>
      }
    />
  )
}
