import { queueTypeForQueueId } from '@foxfire/core'
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
export function lpEditBlockedReason(match: MatchSummary, isMine?: boolean): string | null {
  const notYours = lpWriteBlockedReason(isMine)
  if (notYours) return notYours

  if (queueTypeForQueueId(match.queueId) === null) return 'Only ranked games move LP'
  if (match.isRemake) return 'Remakes move no LP'
  if (match.rank?.lpDelta != null) return 'Already worked out from your rank history'
  return null
}

/**
 * Why LP on this account cannot be written at all, or null when it can.
 *
 * Checked before anything about the game, because it is the reason that will
 * not change: a remake stays a remake, but so does somebody else's account, and
 * being told "already worked out from your rank history" about a stranger's
 * game answers a question nobody asked.
 *
 * Undefined means local-only, where every account in the file is yours and the
 * question does not arise. False is a server saying somebody else claimed it —
 * and the server refuses the write with not_your_account, so offering it here
 * only produces a 403 somebody has to interpret.
 */
export function lpWriteBlockedReason(isMine?: boolean): string | null {
  return isMine === false ? 'Only whoever claimed this account can type its LP' : null
}

/**
 * Why a game has no OBS recording, or null when it does.
 *
 * Stated rather than hidden, exactly as the LP reasons are: "why does this game
 * have footage and that one not?" is a real question, and an item that silently
 * disappears from half the rows cannot answer it.
 */
export function recordingBlockedReason(match: MatchSummary): string | null {
  if ((match.local?.recordingId ?? null) === null) return 'No recording for this game'
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
  if ((match.local?.replayId ?? null) === null) return 'No Riot replay for this game'
  return null
}

/**
 * Why a game's replay cannot be fetched from the server, or null when it can.
 *
 * Three states rather than two, and the middle one is why this is spelled out.
 * A row can have no server copy, a server copy worth downloading, or a server
 * copy of a game whose replay is already on this disk — and in that last case
 * the download is pointless rather than unavailable, which is a different
 * sentence.
 */
export function downloadBlockedReason(match: MatchSummary): string | null {
  if ((match.local?.replayId ?? null) !== null) return 'Already downloaded'
  if (!match.sharedReplay) return 'Nobody has uploaded this game'
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
    onDownloadReplay: () => void
  },
  { expandable = true, isMine }: { expandable?: boolean; isMine?: boolean } = {}
): ContextMenuItem[] {
  const blocked = lpEditBlockedReason(match, isMine)
  const notYours = lpWriteBlockedReason(isMine)
  const noRecording = recordingBlockedReason(match)
  const noReplay = replayBlockedReason(match)
  const noDownload = downloadBlockedReason(match)

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
    // Only when there is something to fetch. Unlike the two above, this item is
    // hidden rather than disabled on a row with no server copy: those two are
    // about a game you played and the absence is worth explaining, while this
    // one is about somebody else having uploaded theirs, and a permanently
    // greyed row on every match in local-only mode explains nothing.
    ...(match.sharedReplay
      ? [
          {
            label: match.sharedReplay.patch
              ? `Download replay (patch ${match.sharedReplay.patch})`
              : 'Download replay',
            onSelect: actions.onDownloadReplay,
            ...(noDownload ? { disabledReason: noDownload } : {})
          }
        ]
      : []),
    match.hasManualRank
      ? {
          label: 'Clear LP edit',
          onSelect: actions.onClearLp,
          // Clearing is a write too. It was the one path with no reason
          // checked at all, so somebody else's hand-entered figure offered
          // itself for deletion.
          ...(notYours ? { disabledReason: notYours } : {})
        }
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
