import { Link } from '@tanstack/react-router'
import { Icon, cardFooterLinkClass } from '@foxfire/ui'

/** The "More" that ends a card in the rail, leading to the page it summarises. */
export function MoreLink({
  to,
  slug,
  search,
  label
}: {
  to: '/players/$slug/rank' | '/players/$slug/champions' | '/players/$slug/tft/rank'
  slug: string
  search: Record<string, unknown>
  label: string
}): JSX.Element {
  return (
    // The router's types are registered by each app, not here.
    <Link to={to} params={{ slug }} search={search as never} className={cardFooterLinkClass}>
      {label}
      <Icon.ChevronDown width={14} height={14} className="-rotate-90" />
    </Link>
  )
}
