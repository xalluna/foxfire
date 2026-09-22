import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { playerSlug } from '@foxfire/core/routes'
import { Icon, Logo } from '@foxfire/ui'
import { queryKeys, useClient } from '@foxfire/screens'
import { CaptureIndicator } from './components/CaptureIndicator'
import { LiveNavIcon } from './components/LiveNavIcon'
import { useRecordingUpdates, useReplayUpdates } from './hooks/useDesktopUpdates'
import { useKeyRejected, useServerHealth } from './hooks/useKeyStatus'
import { useNavSlug } from './hooks/usePlayerNavigation'

/** Pages of one account, found under its slug. */
type PlayerPage =
  | '/players/$slug'
  | '/players/$slug/live'
  | '/players/$slug/captures'
  | '/players/$slug/champions'
  | '/players/$slug/rank'

type NavItem =
  | { label: string; icon: JSX.Element; page: PlayerPage }
  | { label: string; icon: JSX.Element; to: '/search' | '/settings/{-$category}' }

const NAV: NavItem[] = [
  { label: 'Dashboard', icon: <Icon.Dashboard />, page: '/players/$slug' },
  // Coloured by whether a game is on and whether it is being recorded.
  { label: 'Live game', icon: <LiveNavIcon />, page: '/players/$slug/live' },
  { label: 'Captures', icon: <Icon.Film />, page: '/players/$slug/captures' },
  { label: 'Champions', icon: <Icon.Trophy />, page: '/players/$slug/champions' },
  { label: 'Rank', icon: <Icon.TrendingUp />, page: '/players/$slug/rank' },
  { label: 'Search', icon: <Icon.Search />, to: '/search' },
  { label: 'Settings', icon: <Icon.Settings />, to: '/settings/{-$category}' }
]

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

/**
 * A recording window asking the main window to show its match.
 *
 * The window that made the request is a different renderer process with its
 * own query cache, so it cannot open the row here itself — it sends a message
 * and the main process forwards it. Here that becomes a navigation to the
 * account's profile with the game named in the URL, which the profile opens.
 */
function useShowMatchRequests(): void {
  const client = useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(
    () =>
      window.api.recordings.onShowMatch((accountId, matchId) => {
        void queryClient
          .ensureQueryData({ queryKey: queryKeys.accounts(), queryFn: () => client.accounts.list() })
          .then((accounts) => {
            const account = accounts.find((a) => a.id === accountId)
            if (!account) return
            void navigate({
              to: '/players/$slug',
              params: { slug: playerSlug(account) },
              search: { match: matchId }
            })
          })
      }),
    [client, queryClient, navigate]
  )
}

/**
 * The main window: its header and nav, the banners, and whichever page the URL
 * names beneath them. The other windows are routes too, but outside this — see
 * router.tsx.
 */
export function AppShell(): JSX.Element {
  useRecordingUpdates()
  useReplayUpdates()
  useShowMatchRequests()
  const [keyRejected, clearRejected] = useKeyRejected()

  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const slug = useNavSlug()

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get()
  })

  const { connected, riotKeyRejected: serverKeyRejected } = useServerHealth()

  // Only meaningful in local-only mode. Connected to a server this machine holds
  // no key, and the settings page that would ask for one is not even shown.
  const needsKey = settings.data && !settings.data.hasApiKey
  const onSettings = !!matchRoute({ to: '/settings/{-$category}', includeSearch: false })

  const openRiotKeySettings = (): void => {
    void navigate({ to: '/settings/{-$category}', params: { category: 'riot-key' } })
  }

  const isActive = (item: NavItem): boolean => {
    if ('to' in item) return !!matchRoute({ to: item.to, includeSearch: false })
    // With no accounts every player page is the empty home page, which the
    // Dashboard tab stands for.
    if (item.page === '/players/$slug' && matchRoute({ to: '/', includeSearch: false })) return true
    return !!matchRoute({ to: item.page, includeSearch: false })
  }

  const go = (item: NavItem): void => {
    if ('to' in item) {
      if (item.to === '/search') void navigate({ to: '/search' })
      else void navigate({ to: '/settings/{-$category}', params: { category: undefined } })
    } else if (slug === null) {
      void navigate({ to: '/' })
    } else {
      void navigate({ to: item.page, params: { slug } })
    }
  }

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
          {NAV.map((item) => {
            const active = isActive(item)
            return (
              <button
                key={item.label}
                onClick={() => go(item)}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition',
                  active ? 'bg-accent/10 text-accent' : 'text-text-dim hover:bg-surface hover:text-text'
                )}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
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
            openRiotKeySettings()
          }}
        >
          Riot rejected your API key — personal keys expire every 24 hours. Click here to paste a
          fresh one.
        </Banner>
      )}

      {!connected && needsKey && !keyRejected && !onSettings && (
        <Banner tone="warning" onClick={openRiotKeySettings}>
          No Riot API key saved — open Settings to add one before looking anything up.
        </Banner>
      )}

      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
