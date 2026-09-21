import { useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { EmptyState, Icon } from '@foxfire/ui'
import { LpEditorScreen, queueTypeFrom } from '@foxfire/screens'

/**
 * The LP editor, in a window of its own.
 *
 * The editor is the shared screen a browser shows as a page; what is here is
 * what only a window has to do — read what it was opened for from its address,
 * and move to a different game when a second right-click reaches it already
 * open.
 */
export function LpEditorWindow(): JSX.Element {
  const search = useSearch({ from: '/_window/lp-editor' })
  const navigate = useNavigate({ from: '/lp-editor' })

  // Reopening from another row focuses the window instead of reloading it —
  // reloading would throw away whatever had been typed — so the new game
  // arrives as a message, and becomes this window's address.
  useEffect(
    () =>
      window.api.rank.onEditorFocus((matchId) => {
        void navigate({ search: (previous) => ({ ...previous, match: matchId }), replace: true })
      }),
    [navigate]
  )

  if (search.account === undefined || search.queue === undefined) {
    return (
      <div className="min-h-screen bg-canvas p-8 text-text">
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="No game selected"
          description="Open this window by right-clicking a match in the history list."
        />
      </div>
    )
  }

  return (
    <LpEditorScreen
      accountId={search.account}
      queueType={queueTypeFrom(search.queue)}
      focusMatchId={search.match ?? null}
    />
  )
}
