import type { ReactNode } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import { EmptyState, Icon } from '@foxfire/ui'
import { useAuth } from '../session/session'

function Tab({
  to,
  exact,
  short,
  children
}: {
  to: '/admin' | '/admin/invites' | '/admin/accounts' | '/admin/data' | '/admin/insights'
  exact?: boolean
  /** What the tab says on a phone, where five full labels do not fit across. */
  short?: string
  children: ReactNode
}): JSX.Element {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      className="-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition max-sm:px-2"
      activeProps={{ className: 'border-accent text-accent' }}
      inactiveProps={{ className: 'border-transparent text-text-dim hover:text-text' }}
    >
      {short === undefined ? (
        children
      ) : (
        <>
          <span className="max-sm:hidden">{children}</span>
          <span className="sm:hidden">{short}</span>
        </>
      )}
    </Link>
  )
}

/**
 * Administering the server, from a browser — the same pages the desktop shows
 * in its settings.
 *
 * Shown to an administrator and nobody else, which decides what is drawn and
 * nothing more: the server checks the role on every request, so somebody
 * demoted with this page open finds every action refused.
 */
export function AdminLayout(): JSX.Element {
  const isAdmin = useAuth((s) => s.user?.isAdmin ?? false)

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<Icon.Settings />}
        title="Administrators only"
        description="These pages run the server. Ask whoever set it up if something here needs changing."
      />
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Not a scroll container, for the reason in WebPlayerLayout. */}
      <nav className="flex gap-1 border-b border-hairline px-4 max-md:px-2">
        <Tab to="/admin" exact>
          Members
        </Tab>
        <Tab to="/admin/invites">Invites</Tab>
        <Tab to="/admin/accounts" short="Accounts">
          League accounts
        </Tab>
        <Tab to="/admin/data" short="Data">
          Data &amp; storage
        </Tab>
        <Tab to="/admin/insights">Insights</Tab>
      </nav>
      <Outlet />
    </div>
  )
}
