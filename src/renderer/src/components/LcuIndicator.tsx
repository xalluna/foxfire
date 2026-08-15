import clsx from 'clsx'
import { useLcuStatus } from '../hooks/useLcuStatus'
import { useUiStore } from '../store/uiStore'

/**
 * Whether per-game LP is being captured right now.
 *
 * Lives on the Rank page rather than only in Settings: this is the one number
 * on screen that silently depends on the League client being reachable, and
 * "why is nothing being recorded?" should be answerable without going hunting
 * through preferences.
 *
 * Deliberately quiet when connected and only slightly louder when not — it is a
 * status line, not a warning, and the league-v4 backstop still records rank
 * either way.
 */
export function LcuIndicator(): JSX.Element {
  const status = useLcuStatus()
  const setView = useUiStore((s) => s.setView)

  const tone =
    status.state === 'connected'
      ? 'text-teal'
      : status.state === 'untracked'
        ? 'text-amber'
        : 'text-text-mute'

  const label =
    status.state === 'connected'
      ? `League client connected — ${status.gameName}#${status.tagLine}`
      : status.state === 'untracked'
        ? `${status.gameName}#${status.tagLine} is logged in but not tracked here`
        : 'League client not detected — LP is recorded on sync only'

  return (
    <button
      onClick={() => setView('settings')}
      title="Open rank tracking settings"
      className={clsx(
        'mt-1.5 flex items-center gap-1.5 text-2xs transition hover:text-gold',
        tone
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          status.state === 'connected'
            ? 'bg-teal'
            : status.state === 'untracked'
              ? 'bg-amber'
              : 'bg-text-mute'
        )}
      />
      {label}
    </button>
  )
}
