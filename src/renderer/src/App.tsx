import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Disclaimer } from './components/Disclaimer'
import { AccountSidebar } from './components/AccountSidebar'
import { AddAccountForm } from './components/AddAccountForm'
import { Dashboard } from './views/Dashboard'
import { LiveGame } from './views/LiveGame'
import { Mastery } from './views/Mastery'
import { Search } from './views/Search'
import { Settings } from './views/Settings'
import { useSyncProgress } from './hooks/useSyncProgress'
import { useKeyRejected } from './hooks/useKeyStatus'
import { useUiStore, type View } from './store/uiStore'

const NAV: Array<{ id: View; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'liveGame', label: 'Live game' },
  { id: 'mastery', label: 'Champions' },
  { id: 'search', label: 'Search' },
  { id: 'settings', label: 'Settings' }
]

/** Views that operate on the selected account and need the sidebar alongside them. */
const ACCOUNT_VIEWS: View[] = ['dashboard', 'liveGame', 'mastery']

function App(): JSX.Element {
  useSyncProgress()
  const [keyRejected, clearRejected] = useKeyRejected()

  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const activeAccountId = useUiStore((s) => s.activeAccountId)
  const setActiveAccount = useUiStore((s) => s.setActiveAccount)

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get()
  })

  // Land on the home account once accounts load.
  useEffect(() => {
    if (activeAccountId === null && accounts.data && accounts.data.length > 0) {
      const home = accounts.data.find((a) => a.isHomeAccount) ?? accounts.data[0]
      setActiveAccount(home.id)
    }
  }, [accounts.data, activeAccountId, setActiveAccount])

  const activeAccount = accounts.data?.find((a) => a.id === activeAccountId) ?? null
  const needsKey = settings.data && !settings.data.hasApiKey

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex shrink-0 items-center gap-5 border-b border-slate-800 px-5 py-2.5">
        <span className="text-sm font-semibold tracking-tight">LoL Stats</span>
        <nav className="flex gap-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`rounded px-3 py-1 text-xs transition ${
                view === item.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto w-72">
          <AddAccountForm />
        </div>
      </header>

      {keyRejected && (
        <button
          onClick={() => {
            clearRejected()
            setView('settings')
          }}
          className="shrink-0 bg-rose-950/70 px-5 py-2 text-left text-xs text-rose-300 hover:bg-rose-950"
        >
          Riot rejected your API key — personal keys expire every 24 hours. Click here to paste a
          fresh one.
        </button>
      )}

      {needsKey && !keyRejected && view !== 'settings' && (
        <button
          onClick={() => setView('settings')}
          className="shrink-0 bg-amber-950/60 px-5 py-2 text-left text-xs text-amber-300 hover:bg-amber-950"
        >
          No Riot API key saved — open Settings to add one before looking anything up.
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        {ACCOUNT_VIEWS.includes(view) && (
          <>
            <AccountSidebar accounts={accounts.data ?? []} />
            <main className="min-w-0 flex-1 overflow-y-auto">
              {activeAccount ? (
                <>
                  {view === 'dashboard' && (
                    <Dashboard key={activeAccount.id} account={activeAccount} />
                  )}
                  {view === 'liveGame' && (
                    <LiveGame key={activeAccount.id} account={activeAccount} />
                  )}
                  {view === 'mastery' && (
                    <Mastery key={activeAccount.id} account={activeAccount} />
                  )}
                </>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-slate-500">
                    Add an account above to get started.
                  </p>
                </div>
              )}
            </main>
          </>
        )}

        {view === 'search' && (
          <main className="flex-1 overflow-y-auto">
            <Search />
          </main>
        )}

        {view === 'settings' && (
          <main className="flex-1 overflow-y-auto">
            <Settings />
          </main>
        )}
      </div>

      <Disclaimer />
    </div>
  )
}

export default App
