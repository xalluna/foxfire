import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AccountRail } from './components/AccountRail'
import { Dashboard } from './views/Dashboard'
import { LiveGame } from './views/LiveGame'
import { Captures } from './views/Captures'
import { Mastery } from './views/Mastery'
import { RankHistory } from './views/RankHistory'
import { Search } from './views/Search'
import { Settings } from './views/Settings'
import { EmptyState } from './components/EmptyState'
import { Logo } from './components/Logo'
import { CaptureIndicator } from './components/CaptureIndicator'
import { LiveNavIcon } from './components/LiveNavIcon'
import * as Icon from './components/icons'
import {
  useLcuRankUpdates,
  useManualRankUpdates,
  useRecordingUpdates,
  useReplayUpdates,
  useSyncProgress
} from './hooks/useSyncProgress'
import { useKeyRejected, useServerHealth } from './hooks/useKeyStatus'
import { useUiStore, type View } from './store/uiStore'

const NAV: Array<{ id: View; label: string; icon: JSX.Element }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <Icon.Dashboard /> },
  // Coloured by whether a game is on and whether it is being recorded.
  { id: 'liveGame', label: 'Live game', icon: <LiveNavIcon /> },
  { id: 'captures', label: 'Captures', icon: <Icon.Film /> },
  { id: 'mastery', label: 'Champions', icon: <Icon.Trophy /> },
  { id: 'rank', label: 'Rank', icon: <Icon.TrendingUp /> },
  { id: 'search', label: 'Search', icon: <Icon.Search /> },
  { id: 'settings', label: 'Settings', icon: <Icon.Settings /> }
]

/** Views that operate on the selected account and need the rail alongside them. */
const ACCOUNT_VIEWS: View[] = ['dashboard', 'liveGame', 'captures', 'mastery', 'rank']

/**
 * A full-width strip under the title bar. Used for the two Riot key states,
 * which are routine rather than exceptional: personal keys expire every 24h.
 */
/**
 * A strip across the top of the app.
 *
 * Renders as a button only when there is somewhere to go. A banner about the
 * *server's* expired key has nothing on this machine to offer — there is no
 * field to paste into — and one that looked clickable and did nothing would be
 * worse than plain text.
 */
function Banner({
  tone,
  onClick,
  children
}: {
  tone: 'error' | 'warning'
  onClick?: () => void
  children: React.ReactNode
}): JSX.Element {
  const className = clsx(
    'flex shrink-0 items-center gap-2 border-b px-5 py-2 text-left text-sm',
    tone === 'error' ? 'border-red/30 bg-red/10 text-red' : 'border-amber/30 bg-amber/10 text-amber',
    onClick !== undefined && 'transition',
    onClick !== undefined && (tone === 'error' ? 'hover:bg-red/15' : 'hover:bg-amber/15')
  )

  const body = (
    <>
      <Icon.Warning className="shrink-0" />
      <span>{children}</span>
    </>
  )

  if (onClick === undefined) return <div className={className}>{body}</div>

  return (
    <button onClick={onClick} className={className}>
      {body}
    </button>
  )
}

function App(): JSX.Element {
  useSyncProgress()
  useLcuRankUpdates()
  useManualRankUpdates()
  useRecordingUpdates()
  useReplayUpdates()
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
  const { connected, riotKeyRejected: serverKeyRejected } = useServerHealth()

  // Only meaningful in local-only mode. Connected to a server this machine holds
  // no key, and the settings page that would ask for one is not even shown.
  const needsKey = settings.data && !settings.data.hasApiKey
  const showRail = ACCOUNT_VIEWS.includes(view)

  return (
    <div className="flex h-screen flex-col bg-canvas text-text">
      {/*
        Drag strip beneath the native caption buttons. The right padding keeps
        the nav clear of the overlay region Windows draws into; without it the
        last tab would sit under the close button.

        h-titlebar is the *content* height, hence box-content: Windows paints the
        caption buttons over the top --titlebar-h pixels, so a border-box strip
        of that height would hide its own bottom border behind them and the
        hairline would stop short of the window edge. Adding the border outside
        lands it on the first row below the overlay, where it survives.
      */}
      <header
        className="drag box-content flex h-titlebar shrink-0 items-center gap-4 border-b border-hairline pl-4"
        style={{ paddingRight: 'var(--titlebar-controls-w)' }}
      >
        <div className="flex items-center gap-2">
          <Logo className="shrink-0 text-accent" />
          <span className="font-display text-base tracking-wide text-accent">Foxfire</span>
        </div>

        <nav className="no-drag flex gap-0.5">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition',
                view === item.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-dim hover:bg-surface hover:text-text'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto pr-2">
          <CaptureIndicator />
        </div>
      </header>

{/*
        Three banners about one situation, and which one shows depends entirely
        on whose key it is. Connected to a server this machine holds no key at
        all, so neither of the local two can be right — and the server's has no
        "click here", because there is nothing here to paste.
      */}
      {connected && serverKeyRejected && (
        <Banner tone="error">
          This server&rsquo;s Riot API key is not working, so nothing new is being fetched.
          Everything already stored still works. Its administrator needs to replace the key.
        </Banner>
      )}

      {!connected && keyRejected && (
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

      {!connected && needsKey && !keyRejected && view !== 'settings' && (
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
                {view === 'captures' && <Captures key={activeAccount.id} account={activeAccount} />}
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
