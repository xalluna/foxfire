import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import type { PlayerLayoutProps } from '@foxfire/screens'

function Tab({
  to,
  slug,
  exact,
  children
}: {
  to: '/players/$slug' | '/players/$slug/champions' | '/players/$slug/rank'
  slug: string
  exact?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <Link
      to={to}
      params={{ slug }}
      activeOptions={{ exact, includeSearch: false }}
      className="-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition"
      activeProps={{ className: 'border-accent text-accent' }}
      inactiveProps={{ className: 'border-transparent text-text-dim hover:text-text' }}
    >
      {children}
    </Link>
  )
}

/**
 * A player's pages, with the tabs between them.
 *
 * The desktop has an account rail here; a browser has the header's search box
 * for choosing somebody, so this only has to move between one player's views.
 *
 * Capped at 1280px, not narrower, because the dashboard brings its 320px stats
 * rail in at `xl:` — a viewport query, 1280px — and has no cap of its own. A
 * narrower box here still gets the rail on a wide screen, and the match rows
 * lose their items to the list's overflow-hidden.
 *
 * The tabs do not scroll sideways. Three fit the narrowest phone, and a scroll
 * container turns each tab's -mb-px — the pixel that overlaps the hairline —
 * into a 1px vertical scroll, with a scrollbar to match.
 */
export function WebPlayerLayout({ account, children }: PlayerLayoutProps): JSX.Element {
  if (!account) return <div className="mx-auto max-w-7xl">{children}</div>

  const slug = playerSlug(account)

  return (
    <div className="mx-auto max-w-7xl">
      <nav className="flex gap-1 border-b border-hairline px-4 max-md:px-2">
        <Tab to="/players/$slug" slug={slug} exact>
          Profile
        </Tab>
        <Tab to="/players/$slug/champions" slug={slug}>
          Champions
        </Tab>
        <Tab to="/players/$slug/rank" slug={slug}>
          Rank
        </Tab>
      </nav>
      {children}
    </div>
  )
}
