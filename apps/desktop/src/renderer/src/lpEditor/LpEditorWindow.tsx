import { useEffect, useMemo, useState } from 'react'
import type { QueueType } from '@foxfire/core'
import { EmptyState, Icon } from '@foxfire/ui'
import { LpEditorScreen } from '@foxfire/screens'

/**
 * Reads the account and queue this window was opened for.
 *
 * Carried in the hash rather than fetched, because the window is opened from a
 * right-click on a specific row in another renderer process and there is no
 * shared store between the two — see lpEditorWindow.ts.
 */
function readContext(): { accountId: string; queueType: QueueType; matchId: string } | null {
  const raw = window.location.hash.replace(/^#lp-editor\??/, '')
  const params = new URLSearchParams(raw)
  // Taken as written rather than parsed. An account id is opaque now, and
  // this window was already carrying it as text — the parse was only ever
  // there because the id used to be a number.
  const accountId = params.get('account')
  const queueType = params.get('queue')
  const matchId = params.get('match')

  if (!accountId || !queueType || !matchId) return null
  return { accountId, queueType: queueType as QueueType, matchId }
}

/**
 * The LP editor, in a window of its own.
 *
 * The editor is the shared screen a browser shows as a page; what is here is
 * what only a window has to do — work out what it was opened for, and move to
 * a different game when a second right-click reaches it already open.
 */
export function LpEditorWindow(): JSX.Element {
  const context = useMemo(readContext, [])
  const [focusedMatchId, setFocusedMatchId] = useState(context?.matchId ?? null)

  // Reopening from another row focuses the window instead of reloading it, so
  // the scroll has to be driven by a message rather than by the hash.
  useEffect(() => window.api.rank.onEditorFocus(setFocusedMatchId), [])

  if (!context) {
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
      accountId={context.accountId}
      queueType={context.queueType}
      focusMatchId={focusedMatchId}
    />
  )
}
