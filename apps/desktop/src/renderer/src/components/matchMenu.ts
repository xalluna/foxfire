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
 * Why a game has no OBS recording, or null when it does.
 *
 * Stated rather than hidden, exactly as the LP reasons are: "why does this game
 * have footage and that one not?" is a real question, and an item that silently
 * disappears from half the rows cannot answer it.
 */
export function recordingBlockedReason(match: MatchSummary): string | null {
  if (match.recordingId === null) return 'No recording for this game'
  return null
}

/**
 * Why a game has no Riot replay, or null when it does.
 *
 * Only reports whether the file exists. Whether it can actually be *played*
 * depends on which patch it was recorded on and which clients are installed,
 * which the match list has not been told and should not have to be — that
 * answer arrives when the replay is opened, and the Captures tab states it in
 * full.
 */
export function replayBlockedReason(match: MatchSummary): string | null {
  if (match.replayId === null) return 'No Riot replay for this game'
  return null
}

export function matchContextItems(
  match: MatchSummary,
  actions: {
    onEditLp: () => void
    onClearLp: () => void
    onCopyId: () => void
    onOpenDetails: () => void
    onWatchRecording: () => void
    onWatchReplay: () => void
  },
  { expandable = true }: { expandable?: boolean } = {}
): ContextMenuItem[] {
  const blocked = lpEditBlockedReason(match)
  const noRecording = recordingBlockedReason(match)
  const noReplay = replayBlockedReason(match)

  return [
    // Two separate artefacts, so two separate items, both always present. A
    // recording is this player's own screen; a replay is Riot's, with every
    // camera. Collapsing them into one "watch" would have to pick for the user.
    {
      label: 'Watch recording',
      onSelect: actions.onWatchRecording,
      ...(noRecording ? { disabledReason: noRecording } : {})
    },
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
