import { SettingsBlock, SettingsRow, ghostButtonClass, primaryButtonClass } from '@foxfire/ui'
import { ChangelogNotes } from './ChangelogNotes'
import { useUpdates } from '../hooks/useUpdates'
import type { UpdateState } from '@shared/types'

/**
 * The updates half of the About page.
 *
 * Says what is happening in a sentence and offers at most one button, because
 * there is only ever one thing worth doing: ask now, or restart into what has
 * already been downloaded. Everything else — when to check, what to fetch,
 * whether this server will take it — is the main process's business and not a
 * decision to hand somebody in a settings page.
 *
 * The one state with no button is the one the app cannot help with: a build
 * held back by the server it is connected to. That sentence names the server,
 * so whoever reads it knows who to ask.
 */
export function UpdateSettings(): JSX.Element | null {
  const state = useUpdates()
  if (state === null) return null

  const notesVersion = state.target ?? state.current

  return (
    <>
      <SettingsRow label="Updates" description={summary(state)} control={control(state)} />

      {state.notes !== null && (
        <SettingsBlock label={`What's new in ${notesVersion}`}>
          <ChangelogNotes notes={state.notes} />
        </SettingsBlock>
      )}
    </>
  )
}

function control(state: UpdateState): JSX.Element | undefined {
  if (state.status === 'ready') {
    if (state.blockedBy !== null) return undefined
    return (
      <button className={primaryButtonClass} onClick={() => void window.api.updates.restart()}>
        Restart now
      </button>
    )
  }

  // Nothing to offer while it is already doing the thing, and nothing to offer
  // at all in a build that cannot update itself.
  if (state.status === 'checking' || state.status === 'downloading') return undefined
  if (state.status === 'disabled') return undefined

  return (
    <button className={ghostButtonClass} onClick={() => void window.api.updates.check()}>
      Check for updates
    </button>
  )
}

function summary(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return 'Updates are off in a development build.'
    case 'checking':
      return 'Checking for a new version…'
    case 'downloading':
      return `Downloading Foxfire ${state.target}${
        state.percent === null ? '' : ` — ${state.percent}%`
      }`
    case 'ready':
      if (state.blockedBy === 'recording') {
        return `Foxfire ${state.target} is ready. It will install once this recording has finished, or the next time Foxfire quits.`
      }
      if (state.blockedBy === 'game') {
        return `Foxfire ${state.target} is ready. It will install once this game has finished, or the next time Foxfire quits.`
      }
      return `Foxfire ${state.target} is ready. Restarting takes a few seconds; it will otherwise install the next time Foxfire quits.`
    case 'error':
      return `Could not check for updates: ${state.error ?? 'unknown error'}`
    default:
      if (state.heldBy !== null) {
        return `Foxfire ${state.heldBy.newest} is out, but ${state.heldBy.serverName} only accepts up to ${state.heldBy.allows}. This copy stays where it is until whoever runs that server updates it.`
      }
      return 'Foxfire is up to date.'
  }
}
