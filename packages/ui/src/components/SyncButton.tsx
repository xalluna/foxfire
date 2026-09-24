import clsx from 'clsx'
import { useCountdown } from '../hooks/useCountdown'
import { countdownLabel } from '../lib/cooldown'
import * as Icon from './icons'

/**
 * "Sync now", and the two reasons it cannot be pressed: a sync is running, or
 * the account was synced too recently for the server to take another.
 *
 * The second counts down on the button itself rather than in a tooltip, so
 * the wait reads without hovering — on a phone there is nothing to hover —
 * and the button comes back by itself the moment the server will take it. A
 * greyed button with no reason on it would look broken.
 */
export function SyncButton({
  onSync,
  syncing,
  cooldownUntil,
  className
}: {
  onSync: () => void
  syncing: boolean
  /** When the server takes a sync again. Null when nothing holds it back. */
  cooldownUntil: string | null
  className?: string
}): JSX.Element {
  const wait = useCountdown(cooldownUntil)

  return (
    <button
      type="button"
      onClick={onSync}
      disabled={syncing || wait > 0}
      className={clsx(
        'flex items-center gap-1.5 rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium tabular-nums text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute',
        className
      )}
    >
      <Icon.Sync className={syncing ? 'animate-spin' : undefined} />
      {syncing ? 'Syncing…' : wait > 0 ? `Sync in ${countdownLabel(wait)}` : 'Sync now'}
    </button>
  )
}
