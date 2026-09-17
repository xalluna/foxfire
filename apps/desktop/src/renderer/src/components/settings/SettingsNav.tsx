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
export type SettingsCategory = 'riotKey' | 'rank' | 'capture' | 'replays' | 'telemetry' | 'about'

/** The first category, and where Settings always opens. */
export const FIRST_CATEGORY: SettingsCategory = 'riotKey'

/**
 * The sidebar, in groups.
 *
 * Grouped the way the app is: what it needs to talk to Riot, what it records
 * off your machine, and the two pages that are about Foxfire itself rather than
 * about League. The dividers do the work a heading would, without adding six
 * more words to a 220px column.
 */
const GROUPS: Array<Array<{ id: SettingsCategory; label: string; icon: JSX.Element }>> = [
  [
    { id: 'riotKey', label: 'Riot API key', icon: <Icon.Key /> },
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
  onSelect
}: {
  active: SettingsCategory
  onSelect: (category: SettingsCategory) => void
}): JSX.Element {
  return (
    <nav
      aria-label="Settings"
      className="w-rail-open shrink-0 overflow-y-auto bg-canvas px-3 py-6"
    >
      <div className="mb-5 flex items-center gap-2 px-2">
        <Logo className="shrink-0 text-accent" />
        <span className="font-display text-lg text-text">Settings</span>
      </div>

      {GROUPS.map((group, index) => (
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
