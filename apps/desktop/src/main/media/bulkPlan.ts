/**
 * Which of a batch of recordings can go to the server, and in what order.
 *
 * Pure, so the choosing can be tested apart from titles and rows. The renderer
 * offers only what looks eligible, but the list it drew can be minutes old by
 * the time somebody presses the button — an upload finished, a file deleted —
 * so the main process decides again, and says why for each one it leaves out
 * rather than dropping them silently.
 */

export interface BulkCandidate {
  recordingId: number
  /** Epoch milliseconds. */
  startedAt: number
  /** The file is on this disk, and was not deleted on purpose. */
  hasFile: boolean
  /** It found its game, which is what the server keeps it against. */
  hasGame: boolean
  /** The server this PC is on already has it. */
  onServer: boolean
  uploadPending: boolean
}

export type BulkSkipReason = 'missing' | 'no_file' | 'no_game' | 'on_server' | 'pending'

export interface BulkPlan {
  /** In the order to upload them: the oldest game first. */
  queue: number[]
  skipped: Array<{ recordingId: number; reason: BulkSkipReason }>
}

/**
 * Oldest game first.
 *
 * So a long backlog goes up in the order it was played, and if it is stopped
 * halfway what is on the server is a season's first half rather than a
 * scattering across it.
 */
export function planBulkUpload(
  requested: readonly number[],
  candidates: ReadonlyMap<number, BulkCandidate>
): BulkPlan {
  const skipped: BulkPlan['skipped'] = []
  const eligible: BulkCandidate[] = []

  for (const recordingId of new Set(requested)) {
    const candidate = candidates.get(recordingId)
    if (!candidate) skipped.push({ recordingId, reason: 'missing' })
    else if (!candidate.hasFile) skipped.push({ recordingId, reason: 'no_file' })
    else if (!candidate.hasGame) skipped.push({ recordingId, reason: 'no_game' })
    else if (candidate.onServer) skipped.push({ recordingId, reason: 'on_server' })
    else if (candidate.uploadPending) skipped.push({ recordingId, reason: 'pending' })
    else eligible.push(candidate)
  }

  eligible.sort((a, b) => a.startedAt - b.startedAt || a.recordingId - b.recordingId)
  return { queue: eligible.map((candidate) => candidate.recordingId), skipped }
}

/** Why a recording was left out of a batch, in words. */
export function describeSkip(reason: BulkSkipReason): string {
  switch (reason) {
    case 'missing':
      return 'It is no longer on this machine.'
    case 'no_file':
      return 'Its video file is no longer on this disk.'
    case 'no_game':
      return 'It never found its game, which the server keeps a recording against.'
    case 'on_server':
      return 'It is already on the server.'
    case 'pending':
      return 'An upload of it is already on its way.'
  }
}
