import { queueTypeForQueueId } from '@shared/queues'
import type { MatchSummary } from '@shared/types'
import type { ContextMenuItem } from './ContextMenu'

/**
 * Why a game cannot be given an LP figure by hand, or null when it can.
 *
 * The reasons are shown on the disabled menu item rather than being hidden,
 * because "why does this row have no LP?" is the question the editor exists to
 * answer, and two rows offering different menus with no explanation only makes
 * it harder to work out.
 */
export function lpEditBlockedReason(match: MatchSummary): string | null {
  if (queueTypeForQueueId(match.queueId) === null) return 'Only ranked games move LP'
  if (match.isRemake) return 'Remakes move no LP'
  if (match.rank?.lpDelta != null) return 'Already worked out from your rank history'
  return null
}

/**
 * Why a game cannot be watched back, or null when it can.
 *
 * Stated rather than hidden, exactly as the LP reasons are: "why does this game
 * have a replay and that one not?" is a real question, and an item that
 * silently disappears from half the rows cannot answer it.
 */
export function replayBlockedReason(match: MatchSummary): string | null {
  if (match.replayId === null) return 'No recording for this game'
  return null
}

export function matchContextItems(
  match: MatchSummary,
  actions: {
    onEditLp: () => void
    onClearLp: () => void
    onCopyId: () => void
    onOpenDetails: () => void
    onWatchReplay: () => void
  },
  { expandable = true }: { expandable?: boolean } = {}
): ContextMenuItem[] {
  const blocked = lpEditBlockedReason(match)
  const noReplay = replayBlockedReason(match)

  return [
    {
      label: 'Watch replay',
      onSelect: actions.onWatchReplay,
      ...(noReplay ? { disabledReason: noReplay } : {})
    },
    match.hasManualRank
      ? { label: 'Clear LP edit', onSelect: actions.onClearLp }
      : {
          label: 'Edit LP gain…',
          onSelect: actions.onEditLp,
          ...(blocked ? { disabledReason: blocked } : {})
        },
    { label: 'Copy match ID', onSelect: actions.onCopyId },
    {
      label: 'Open match details',
      onSelect: actions.onOpenDetails,
      // Ad-hoc search results are never stored, so there is no detail to open.
      ...(expandable ? {} : { disabledReason: 'Not available for search results' })
    }
  ]
}
