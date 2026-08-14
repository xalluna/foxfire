import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export function Settings(): JSX.Element {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get()
  })

  const save = useMutation({
    mutationFn: (value: string) => window.api.settings.setApiKey(value),
    onSuccess: (result) => {
      if (result.ok) {
        setKey('')
        setError(null)
        queryClient.invalidateQueries({ queryKey: ['settings'] })
      } else {
        setError(result.message ?? 'Could not save key')
      }
    }
  })

  const clear = useMutation({
    mutationFn: () => window.api.settings.clearApiKey(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] })
  })

  const hasKey = settings.data?.hasApiKey ?? false

  return (
    <div className="mx-auto w-full max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="mt-6 rounded-lg border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-sm font-medium text-slate-200">Riot API key</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Stored encrypted on this machine only. Personal development keys expire every 24 hours —
          when lookups start failing, paste a fresh one from the Riot developer portal.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${hasKey ? 'bg-emerald-400' : 'bg-slate-600'}`}
          />
          <span className="text-xs text-slate-400">
            {hasKey ? 'A key is saved' : 'No key saved yet'}
          </span>
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            save.mutate(key)
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="RGAPI-..."
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={!key.trim() || save.isPending}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {save.isPending ? 'Checking…' : 'Save'}
          </button>
        </form>

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
        {save.isSuccess && save.data.ok && !error && (
          <p className="mt-3 text-xs text-emerald-400">Key verified against Riot and saved.</p>
        )}

        {hasKey && (
          <button
            onClick={() => clear.mutate()}
            className="mt-4 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300"
          >
            Remove saved key
          </button>
        )}
      </section>
    </div>
  )
}
