import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseRiotId } from '../lib/riotId'
import { useUiStore } from '../store/uiStore'

export function AddAccountForm({ onAdded }: { onAdded?: () => void }): JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const setActiveAccount = useUiStore((s) => s.setActiveAccount)

  const add = useMutation({
    mutationFn: (raw: string) => {
      const parsed = parseRiotId(raw)
      if (!parsed) throw new Error('Enter a Riot ID like Alluna#NA1')
      return window.api.accounts.add(parsed)
    },
    onSuccess: (account) => {
      setValue('')
      setError(null)
      setActiveAccount(account.id)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
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
          placeholder="Alluna#NA1"
          spellCheck={false}
          autoFocus
          className="w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-text outline-none transition placeholder:text-text-mute focus:border-gold-dim"
        />
        <button
          type="submit"
          disabled={!value.trim() || add.isPending}
          className="w-full rounded-md border border-gold-dim bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
        >
          {add.isPending ? 'Adding…' : 'Add account'}
        </button>
      </form>
      {error && <p className="mt-1.5 text-2xs leading-snug text-red">{error}</p>}
    </div>
  )
}
