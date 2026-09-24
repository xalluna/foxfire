/**
 * Which of a batch of recordings can go to YouTube, and in what order.
 *
 * Pure, so the choosing can be tested apart from drafting titles and writing
 * rows. The renderer offers only what looks eligible, but the list it drew can
 * be minutes old by the time somebody presses the button — an upload finished,
 * a file deleted — so the main process decides again, and says why for each
 * one it leaves out rather than dropping them silently.
 */

export interface BulkCandidate {
  recordingId: number
  /** Epoch milliseconds. */
  startedAt: number
  /** The file is on this disk, and was not deleted on purpose. */
  hasFile: boolean
  onYouTube: boolean
  uploadPending: boolean
}

export type BulkSkipReason = 'missing' | 'no_file' | 'on_youtube' | 'pending'

export interface BulkPlan {
  /** In the order to upload them: the oldest game first. */
  queue: number[]
  skipped: Array<{ recordingId: number; reason: BulkSkipReason }>
}

/**
 * Oldest game first.
 *
 * So the videos arrive on the channel in the order they were played, and a
 * batch that runs over the daily quota finishes the older games before it
 * waits — the newest are the ones a person is most likely to upload by hand
 * in the meantime.
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
    else if (candidate.onYouTube) skipped.push({ recordingId, reason: 'on_youtube' })
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
    case 'on_youtube':
      return 'It is already on YouTube.'
    case 'pending':
      return 'An upload of it is already on its way.'
  }
}
