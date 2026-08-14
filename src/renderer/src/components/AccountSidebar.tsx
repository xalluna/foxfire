import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Account } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { profileIconUrl } from '../lib/assets'
import { useUiStore } from '../store/uiStore'

export function AccountSidebar({ accounts }: { accounts: Account[] }): JSX.Element {
  const assets = useAssets()
  const queryClient = useQueryClient()
  const activeAccountId = useUiStore((s) => s.activeAccountId)
  const setActiveAccount = useUiStore((s) => s.setActiveAccount)

  const setHome = useMutation({
    mutationFn: (id: number) => window.api.accounts.setHome(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] })
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.accounts.remove(id),
    onSuccess: (remaining) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      if (remaining.length > 0) setActiveAccount(remaining[0].id)
      else setActiveAccount(null)
    }
  })

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800">
      <p className="px-4 pb-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        My accounts
      </p>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {accounts.length === 0 && (
          <li className="px-2 text-xs text-slate-500">No accounts yet.</li>
        )}
        {accounts.map((account) => {
          const icon = assets ? profileIconUrl(assets, account.profileIconId) : null
          const isActive = account.id === activeAccountId
          return (
            <li key={account.id} className="group relative">
              <button
                onClick={() => setActiveAccount(account.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition ${
                  isActive ? 'bg-slate-800' : 'hover:bg-slate-900'
                }`}
              >
                {icon ? (
                  <img src={icon} alt="" className="h-7 w-7 shrink-0 rounded" />
                ) : (
                  <div className="h-7 w-7 shrink-0 rounded bg-slate-800" />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${isActive ? 'text-slate-100' : 'text-slate-300'}`}
                  >
                    {account.gameName}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    #{account.tagLine}
                    {account.isHomeAccount && ' · home'}
                  </span>
                </span>
              </button>

              <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                {!account.isHomeAccount && (
                  <button
                    title="Set as home account"
                    onClick={() => setHome.mutate(account.id)}
                    className="rounded bg-slate-900 px-1 text-[10px] text-slate-400 hover:text-sky-400"
                  >
                    ★
                  </button>
                )}
                <button
                  title="Remove account"
                  onClick={() => {
                    if (confirm(`Remove ${account.gameName}#${account.tagLine}?`)) {
                      remove.mutate(account.id)
                    }
                  }}
                  className="rounded bg-slate-900 px-1 text-[10px] text-slate-400 hover:text-rose-400"
                >
                  ✕
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
