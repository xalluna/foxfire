import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { randomExampleRiotId, parseRiotId } from '@foxfire/ui'
import { queryKeys } from '@foxfire/screens'
import { useServerHealth } from '../hooks/useKeyStatus'
import { useSwitchPlayer } from '../hooks/usePlayerNavigation'

/**
 * How an account is added, which is not the same question in the two modes.
 *
 * Locally it is a Riot ID somebody types, resolved through their own key. On a
 * server it is attested: the desktop reports the Riot ID the running League
 * client says is signed in, and the server resolves that. A typed name attests
 * to nothing, and a server that accepted one would make every claim on it worth
 * less — so there is no box to type into, and saying why beats a form that
 * always fails.
 */
export function AddAccountForm({ onAdded }: { onAdded?: () => void }): JSX.Element {
  const { connected } = useServerHealth()
  return connected ? <LinkThroughTheClient /> : <TypeARiotId onAdded={onAdded} />
}

/**
 * What to do instead, on a server.
 *
 * The League client is what claims an account here, and it does so on its own:
 * the watcher notices who is signed in and offers the link. So this is an
 * instruction rather than a control — there is nothing for a button to do that
 * starting the client would not do better.
 */
function LinkThroughTheClient(): JSX.Element {
  return (
    <p className="text-2xs leading-relaxed text-text-mute">
      On a server, accounts are claimed by the League client rather than typed in. Sign in to the
      account you want in the client with Foxfire running, and it will offer to link it — which is
      what stops anybody else claiming an account that is yours.
    </p>
  )
}

function TypeARiotId({ onAdded }: { onAdded?: () => void }): JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Drawn once per mount so the hint below never names a different player than
  // the one greyed out in the box.
  const [example] = useState(randomExampleRiotId)
  const queryClient = useQueryClient()
  const switchPlayer = useSwitchPlayer()

  const add = useMutation({
    mutationFn: (raw: string) => {
      const parsed = parseRiotId(raw)
      if (!parsed) throw new Error(`Enter a Riot ID like ${example}`)
      return window.api.accounts.add(parsed)
    },
    onSuccess: async (account) => {
      setValue('')
      setError(null)
      // The page is found by looking the account up in the list, so the list
      // has to have it before the page is asked for — or the first thing the
      // new account shows is "no player by that name".
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      switchPlayer(account)
      onAdded?.()
    },
    onError: (err: Error) => {
      setError(
        err.message.includes('404') || err.message.includes('Not found')
          ? 'No summoner found with that Riot ID.'
          : err.message
      )
    }
  })

  return (
    <div>
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          add.mutate(value)
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={example}
          spellCheck={false}
          autoFocus
          className="w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-text outline-none transition placeholder:text-text-mute focus:border-accent-dim"
        />
        <button
          type="submit"
          disabled={!value.trim() || add.isPending}
          className="w-full rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
        >
          {add.isPending ? 'Adding…' : 'Add account'}
        </button>
      </form>
      {error && <p className="mt-1.5 text-2xs leading-snug text-red">{error}</p>}
    </div>
  )
}
