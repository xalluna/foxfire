import { Logo, primaryButtonClass } from '@foxfire/ui'
import { useAuth } from '../session/session'

/**
 * Over everything, once the server has stopped serving this page's API.
 *
 * Only ever a tab left open across an upgrade: the server serves the web
 * client, so a fresh load is always the matching one. Reloading is the whole
 * remedy, and the page cannot usefully do anything else until it happens.
 */
export function UpgradeOverlay(): JSX.Element | null {
  const upgradeRequired = useAuth((s) => s.upgradeRequired)
  if (!upgradeRequired) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/90 p-4 backdrop-blur-sm">
      <div className="max-w-sm rounded-lg border border-accent-dim bg-surface p-6 text-center">
        <Logo width={28} height={28} className="mx-auto text-accent" />
        <h2 className="mt-3 font-display text-lg text-text">Foxfire was updated</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-text-dim">
          This page is from before the server was updated. Reload to carry on where you were.
        </p>
        <button onClick={() => window.location.reload()} className={`${primaryButtonClass} mt-4`}>
          Reload
        </button>
      </div>
    </div>
  )
}
