import { queueTypeForQueueId, type MatchSummary } from '@foxfire/core'
import type { ContextMenuItem } from '@foxfire/ui'

/**
 * Why a game cannot be given an LP figure by hand, or null when it can.
 *
 * The reasons are shown on the disabled menu item rather than being hidden,
 * because "why does this row have no LP?" is the question the editor exists to
 * answer, and two rows offering different menus with no explanation only makes
 * it harder to work out.
 */
export function lpEditBlockedReason(
  match: MatchSummary,
  isMine?: boolean,
  isHeadAdmin = false
): string | null {
  const notYours = lpWriteBlockedReason(isMine, isHeadAdmin)
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
 * only produces a 403 somebody has to interpret. Unless they are a head admin,
 * who may type LP on anybody's account.
 */
export function lpWriteBlockedReason(isMine?: boolean, isHeadAdmin = false): string | null {
  return isMine === false && !isHeadAdmin ? 'Only whoever claimed this account can type its LP' : null
}

/**
 * Why a game has no recording to watch, or null when it does.
 *
 * Stated rather than hidden, exactly as the LP reasons are: "why does this game
 * have footage and that one not?" is a real question, and an item that silently
 * disappears from half the rows cannot answer it.
 *
 * Two places a recording can be: this machine's disk, and YouTube by way of a
 * server. Both are this row's player's own — a server only puts a recording on
 * the row of the account it belongs to — so the same game in somebody else's
 * history says there is nothing to watch, which is the truth for that view.
 */
export function recordingBlockedReason(match: MatchSummary): string | null {
  if ((match.local?.recordingId ?? null) === null && !match.recording) return 'No recording for this game'
  return null
}

/**
 * A row as a client that cannot play YouTube should see it: without the
 * recording a server holds.
 *
 * A server can hold one while this client was built without YouTube — see the
 * apps' feature switches — and a marker promising a recording that nothing
 * here can play, or a menu offering to watch it, would be a promise broken on
 * the click. The row's own files on this disk are left as they are.
 */
export function withoutServerRecording(match: MatchSummary): MatchSummary {
  return match.recording ? { ...match, recording: null } : match
}

/**
 * Whether this machine's recording of the game could go to YouTube, and why not.
 *
 * Null means the item is not offered at all: nothing on this disk to upload,
 * somebody else's account, or already there. A string is the item offered but
 * disabled — an upload of this game is already on its way.
 */
function uploadState(match: MatchSummary, isMine?: boolean): 'offer' | 'pending' | null {
  if (isMine === false) return null
  if ((match.local?.recordingId ?? null) === null) return null
  if (match.local?.recordingVideoId || match.recording) return null
  return match.local?.recordingUploadPending ? 'pending' : 'offer'
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

/**
 * What a row's menu can do, as the platform and the screen supply it.
 *
 * Copying the id and opening the details work everywhere. The rest are offered
 * only when supplied: a browser has no recording to open and no League client
 * to hand a replay to, and an item it could never act on — greyed out on every
 * row, forever — would explain nothing to anybody.
 */
export interface MatchMenuActions {
  onCopyId: () => void
  onOpenDetails: () => void
  /**
   * A link to the game in the server's web client. Absent in local-only mode
   * and from a server that does not say where its web client is, and then the
   * item is not offered at all.
   */
  onCopyLink?: () => void
  onEditLp?: () => void
  onClearLp?: () => void
  onWatchRecording?: () => void
  /** Puts this machine's recording on YouTube. Desktop only. */
  onUploadRecording?: () => void
  /** Attaches a video somebody uploaded themselves. */
  onAttachRecordingLink?: () => void
  /** Takes the server's recording off this game. The video stays on YouTube. */
  onDetachRecording?: () => void
  onWatchReplay?: () => void
  onDownloadReplay?: () => void
}

/** Who is looking and where, as far as the menu needs to know. */
export interface MatchMenuContext {
  expandable?: boolean
  /** Undefined in local-only mode; false when a server says somebody else claimed the account. */
  isMine?: boolean
  /** An admin may take a recording off anybody's game, though never put one on. */
  isAdmin?: boolean
  /** A head admin may also type and clear LP on anybody's account. */
  isHeadAdmin?: boolean
  /** Connected to a server, where a link can be attached with nothing on this disk behind it. */
  serverMode?: boolean
}

export function matchContextItems(
  match: MatchSummary,
  actions: MatchMenuActions,
  { expandable = true, isMine, isAdmin = false, isHeadAdmin = false, serverMode = false }: MatchMenuContext = {}
): ContextMenuItem[] {
  const blocked = lpEditBlockedReason(match, isMine, isHeadAdmin)
  const notYours = lpWriteBlockedReason(isMine, isHeadAdmin)
  const noRecording = recordingBlockedReason(match)
  const noReplay = replayBlockedReason(match)
  const noDownload = downloadBlockedReason(match)

  const items: ContextMenuItem[] = []

  // Two separate artefacts, so two separate items, both present wherever this
  // machine can play them. A recording is this player's own screen; a replay is
  // Riot's, with every camera. Collapsing them into one "watch" would have to
  // pick for the user.
  if (actions.onWatchRecording) {
    items.push({
      label: 'Watch recording',
      onSelect: actions.onWatchRecording,
      ...(noRecording ? { disabledReason: noRecording } : {})
    })
  }

  // Putting footage on YouTube, or a link to some that is already there. Only
  // on your own rows: a recording is a claim about whose screen it was, and
  // the server refuses it for anybody else's account.
  const upload = uploadState(match, isMine)
  if (upload && actions.onUploadRecording) {
    items.push({
      label: 'Upload recording to YouTube',
      onSelect: actions.onUploadRecording,
      ...(upload === 'pending' ? { disabledReason: 'Uploading…' } : {})
    })
  }

  const hasLocalRecording = (match.local?.recordingId ?? null) !== null
  if (actions.onAttachRecordingLink && isMine !== false && (serverMode || hasLocalRecording)) {
    items.push({
      label:
        match.recording || match.local?.recordingVideoId ? 'Replace YouTube link…' : 'Attach YouTube link…',
      onSelect: actions.onAttachRecordingLink
    })
  }

  if (match.recording && actions.onDetachRecording && (isMine === true || isAdmin)) {
    items.push({ label: 'Remove recording from server', onSelect: actions.onDetachRecording })
  }

  if (actions.onWatchReplay) {
    items.push({
      label: 'Watch replay',
      onSelect: actions.onWatchReplay,
      ...(noReplay ? { disabledReason: noReplay } : {})
    })
  }

  // Only when there is something to fetch. Unlike the two above, this item is
  // hidden rather than disabled on a row with no server copy: those two are
  // about a game you played and the absence is worth explaining, while this
  // one is about somebody else having uploaded theirs, and a permanently
  // greyed row on every match in local-only mode explains nothing.
  if (match.sharedReplay && actions.onDownloadReplay) {
    items.push({
      label: match.sharedReplay.patch
        ? `Download replay (patch ${match.sharedReplay.patch})`
        : 'Download replay',
      onSelect: actions.onDownloadReplay,
      ...(noDownload ? { disabledReason: noDownload } : {})
    })
  }

  if (match.hasManualRank && actions.onClearLp) {
    items.push({
      label: 'Clear LP edit',
      onSelect: actions.onClearLp,
      // Clearing is a write too. It was the one path with no reason
      // checked at all, so somebody else's hand-entered figure offered
      // itself for deletion.
      ...(notYours ? { disabledReason: notYours } : {})
    })
  } else if (!match.hasManualRank && actions.onEditLp) {
    items.push({
      label: 'Edit LP gain…',
      onSelect: actions.onEditLp,
      ...(blocked ? { disabledReason: blocked } : {})
    })
  }

  if (actions.onCopyLink) items.push({ label: 'Copy link', onSelect: actions.onCopyLink })

  items.push(
    { label: 'Copy match ID', onSelect: actions.onCopyId },
    {
      label: 'Open match details',
      onSelect: actions.onOpenDetails,
      // The match page is already the detail, so there is nowhere to open.
      ...(expandable ? {} : { disabledReason: 'You are already looking at it' })
    }
  )

  return items
}
