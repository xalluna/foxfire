import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '../store/uiStore'

/** Accepts "Name#TAG" or a bare name (defaulting to the NA1 tag). */
function parseRiotId(raw: string): { gameName: string; tagLine: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const hashIndex = trimmed.lastIndexOf('#')
  if (hashIndex === -1) return { gameName: trimmed, tagLine: 'NA1' }
  const gameName = trimmed.slice(0, hashIndex).trim()
  const tagLine = trimmed.slice(hashIndex + 1).trim()
  if (!gameName || !tagLine) return null
  return { gameName, tagLine }
}

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
        className="flex gap-2"
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
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-500"
        />
        <button
          type="submit"
          disabled={!value.trim() || add.isPending}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {add.isPending ? 'Adding…' : 'Add account'}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  )
}
