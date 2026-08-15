import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AccountRail } from './components/AccountRail'
import { Dashboard } from './views/Dashboard'
import { LiveGame } from './views/LiveGame'
import { Mastery } from './views/Mastery'
import { RankHistory } from './views/RankHistory'
import { Search } from './views/Search'
import { Settings } from './views/Settings'
import { EmptyState } from './components/EmptyState'
import * as Icon from './components/icons'
import { useLcuRankUpdates, useSyncProgress } from './hooks/useSyncProgress'
import { useKeyRejected } from './hooks/useKeyStatus'
import { useUiStore, type View } from './store/uiStore'

const NAV: Array<{ id: View; label: string; icon: JSX.Element }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <Icon.Dashboard /> },
  { id: 'liveGame', label: 'Live game', icon: <Icon.Live /> },
  { id: 'mastery', label: 'Champions', icon: <Icon.Trophy /> },
  { id: 'rank', label: 'Rank', icon: <Icon.TrendingUp /> },
  { id: 'search', label: 'Search', icon: <Icon.Search /> },
  { id: 'settings', label: 'Settings', icon: <Icon.Settings /> }
]

/** Views that operate on the selected account and need the rail alongside them. */
const ACCOUNT_VIEWS: View[] = ['dashboard', 'liveGame', 'mastery', 'rank']

/**
 * A full-width strip under the title bar. Used for the two Riot key states,
 * which are routine rather than exceptional: personal keys expire every 24h.
 */
function Banner({
  tone,
  onClick,
  children
}: {
  tone: 'error' | 'warning'
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex shrink-0 items-center gap-2 border-b px-5 py-2 text-left text-sm transition',
        tone === 'error'
          ? 'border-red/30 bg-red/10 text-red hover:bg-red/15'
          : 'border-amber/30 bg-amber/10 text-amber hover:bg-amber/15'
      )}
    >
      <Icon.Warning className="shrink-0" />
      <span>{children}</span>
    </button>
  )
}

function App(): JSX.Element {
  useSyncProgress()
  useLcuRankUpdates()
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
  const showRail = ACCOUNT_VIEWS.includes(view)

  return (
    <div className="flex h-screen flex-col bg-canvas text-text">
      {/*
        Drag strip beneath the native caption buttons. The right padding keeps
        the nav clear of the overlay region Windows draws into; without it the
        last tab would sit under the close button.
      */}
      <header
        className="drag flex h-titlebar shrink-0 items-center gap-4 border-b border-hairline pl-4"
        style={{ paddingRight: 'var(--titlebar-controls-w)' }}
      >
        <span className="font-display text-base tracking-wide text-gold">LoL Stats</span>

        <nav className="no-drag flex gap-0.5">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition',
                view === item.id
                  ? 'bg-gold/10 text-gold'
                  : 'text-text-dim hover:bg-surface hover:text-text'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {keyRejected && (
        <Banner
          tone="error"
          onClick={() => {
            clearRejected()
            setView('settings')
          }}
        >
          Riot rejected your API key — personal keys expire every 24 hours. Click here to paste a
          fresh one.
        </Banner>
      )}

      {needsKey && !keyRejected && view !== 'settings' && (
        <Banner tone="warning" onClick={() => setView('settings')}>
          No Riot API key saved — open Settings to add one before looking anything up.
        </Banner>
      )}

      <div className="flex min-h-0 flex-1">
        {showRail && <AccountRail accounts={accounts.data ?? []} />}

        <main className="min-w-0 flex-1 overflow-y-auto">
          {showRail ? (
            activeAccount ? (
              <>
                {view === 'dashboard' && <Dashboard key={activeAccount.id} account={activeAccount} />}
                {view === 'liveGame' && <LiveGame key={activeAccount.id} account={activeAccount} />}
                {view === 'mastery' && <Mastery key={activeAccount.id} account={activeAccount} />}
                {view === 'rank' && <RankHistory key={activeAccount.id} account={activeAccount} />}
              </>
            ) : (
              <EmptyState
                icon={<Icon.Plus />}
                title="No accounts yet"
                description="Add a Riot ID from the rail on the left to start tracking matches, rank and champion stats."
              />
            )
          ) : (
            <>
              {view === 'search' && <Search />}
              {view === 'settings' && <Settings />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
