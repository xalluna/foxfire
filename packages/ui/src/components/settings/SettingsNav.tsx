import clsx from 'clsx'
import { Logo } from '../Logo'

/** One page in the sidebar. */
export interface SettingsNavItem<Id extends string = string> {
  id: Id
  label: string
  icon: JSX.Element
}

/**
 * The settings sidebar, in groups.
 *
 * Which pages exist, and which of them a given person sees, is the caller's
 * business — the desktop has pages about this PC that a browser never will —
 * so the groups arrive already filtered. An empty group is dropped rather than
 * leaving a divider with nothing under it.
 *
 * The dividers do the work a heading would, without adding more words to a
 * 220px column.
 */
export function SettingsNav<Id extends string>({
  groups,
  active,
  onSelect,
  title = 'Settings'
}: {
  groups: Array<Array<SettingsNavItem<Id>>>
  active: Id
  onSelect: (id: Id) => void
  title?: string
}): JSX.Element {
  const shown = groups.filter((group) => group.length > 0)

  return (
    <nav aria-label={title} className="w-rail-open shrink-0 overflow-y-auto bg-canvas px-3 py-6">
      <div className="mb-5 flex items-center gap-2 px-2">
        <Logo className="shrink-0 text-accent" />
        <span className="font-display text-lg text-text">{title}</span>
      </div>

      {shown.map((group, index) => (
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
