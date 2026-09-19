import clsx from 'clsx'
import { Logo } from '../Logo'
import * as Icon from '../icons'

/**
 * Which settings page is on screen.
 *
 * Ranked seasons is not one of these. It was its own top-level section when
 * every section was a fold, but it exists to serve rank history — the dates
 * decide which games belong to which season — so it is now a card on the Rank
 * tracking page rather than a sibling of it.
 */
export type SettingsCategory =
  | 'server'
  | 'serverAdmin'
  | 'serverData'
  | 'riotKey'
  | 'rank'
  | 'capture'
  | 'replays'
  | 'telemetry'
  | 'about'

/**
 * The first category, and where Settings always opens.
 *
 * Still the Riot key rather than Server, because the key is what the app cannot
 * work without and both of App's key banners land here. Server sits above it in
 * the sidebar — it is the bigger decision, and it decides whether the key page
 * applies at all — but it is not where somebody with a problem needs to arrive.
 */
export const FIRST_CATEGORY: SettingsCategory = 'riotKey'

/**
 * The sidebar, in groups.
 *
 * Grouped the way the app is: where its data comes from, what it records off
 * your machine, and the two pages that are about Foxfire itself rather than
 * about League. The dividers do the work a heading would, without adding six
 * more words to a 220px column.
 */
interface NavItem {
  id: SettingsCategory
  label: string
  icon: JSX.Element
  /** Shown only to an administrator of the server currently connected. */
  adminOnly?: boolean
  /**
   * Hidden while a server is answering.
   *
   * For the one page that is genuinely about nothing then: connected, this
   * machine holds no Riot key at all — the server has one, shared by everybody
   * on it — so a page offering to save one would be offering to save something
   * nothing would read.
   */
  localOnly?: boolean
}

const GROUPS: NavItem[][] = [
  [
    { id: 'server', label: 'Server', icon: <Icon.Server /> },
    { id: 'serverAdmin', label: 'Server management', icon: <Icon.Settings />, adminOnly: true },
    { id: 'serverData', label: 'Data & storage', icon: <Icon.Inbox />, adminOnly: true },
    { id: 'riotKey', label: 'Riot API key', icon: <Icon.Key />, localOnly: true },
    { id: 'rank', label: 'Rank tracking', icon: <Icon.TrendingUp /> }
  ],
  [
    { id: 'capture', label: 'Game capture', icon: <Icon.Film /> },
    { id: 'replays', label: 'Riot replays', icon: <Icon.Replay /> }
  ],
  [
    { id: 'telemetry', label: 'Developer telemetry', icon: <Icon.Activity /> },
    { id: 'about', label: 'About', icon: <Icon.Info /> }
  ]
]

export function SettingsNav({
  active,
  isServerAdmin,
  isConnected,
  onSelect
}: {
  active: SettingsCategory
  /**
   * Whether the active session says this person administers the server.
   *
   * Decides what to draw and nothing else. The server checks the role on every
   * request it serves, so a window belonging to somebody demoted a minute ago
   * shows a page whose every call is refused — which is the right way round.
   */
  isServerAdmin: boolean

  /** Whether a server is currently answering, which hides the pages about this PC's key. */
  isConnected: boolean

  onSelect: (category: SettingsCategory) => void
}): JSX.Element {
  const groups = GROUPS.map((group) =>
    group.filter(
      (item) => (!item.adminOnly || isServerAdmin) && (!item.localOnly || !isConnected)
    )
  ).filter((group) => group.length > 0)

  return (
    <nav
      aria-label="Settings"
      className="w-rail-open shrink-0 overflow-y-auto bg-canvas px-3 py-6"
    >
      <div className="mb-5 flex items-center gap-2 px-2">
        <Logo className="shrink-0 text-accent" />
        <span className="font-display text-lg text-text">Settings</span>
      </div>

      {groups.map((group, index) => (
        <div
          key={group[0].id}
          className={clsx('space-y-0.5', index > 0 && 'mt-3 border-t border-hairline pt-3')}
        >
          {group.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              aria-current={active === item.id ? 'page' : undefined}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition',
                active === item.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-dim hover:bg-surface hover:text-text'
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
