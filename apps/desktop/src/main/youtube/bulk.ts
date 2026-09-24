import { existsSync } from 'node:fs'
import { getDb } from '../db'
import { getRecordingIdentity } from '../db/repositories/recordings.repo'
import { getUpload } from '../db/repositories/youtubeUploads.repo'
import { createLogger } from '../telemetry/logger'
import { describeSkip, planBulkUpload, type BulkCandidate } from './bulkPlan'
import { draftFor } from './drafts'
import { enqueueMany } from './queue'
import type { BulkUploadResult, UploadRequest, YouTubePrivacy } from '@shared/types'
import { isUploadPending } from '@shared/uploadEligibility'

const log = createLogger('youtube')

/**
 * Queues many recordings at once, each with its own title and description.
 *
 * YouTube requires the uploader to choose the title, description and privacy,
 * and a batch does that the way the automatic upload does: privacy is chosen
 * for the batch, and each recording's title and description come from the
 * template in Settings, filled in from its own game. So fifty games is one
 * click rather than fifty forms, and every video still says which game it is.
 *
 * Drafts are made one at a time, in order. Connected to a server a draft can
 * ask it for the game, and fifty of those at once would be a burst the server
 * has no reason to take.
 */
export async function enqueueBatch(recordingIds: readonly number[], privacy: YouTubePrivacy): Promise<BulkUploadResult> {
  const db = getDb()

  const candidates = new Map<number, BulkCandidate>()
  for (const recordingId of recordingIds) {
    const identity = getRecordingIdentity(db, recordingId)
    if (!identity) continue
    const upload = getUpload(db, recordingId)
    candidates.set(recordingId, {
      recordingId,
      startedAt: identity.startedAt,
      hasFile: !identity.fileDeleted && existsSync(identity.filePath),
      onYouTube: identity.youtubeVideoId !== null,
      uploadPending: isUploadPending(upload)
    })
  }

  const plan = planBulkUpload(recordingIds, candidates)
  const skipped = plan.skipped.map(({ recordingId, reason }) => ({ recordingId, reason: describeSkip(reason) }))

  const requests: UploadRequest[] = []
  for (const recordingId of plan.queue) {
    try {
      const draft = await draftFor(recordingId)
      requests.push({ recordingId, title: draft.title, description: draft.description, privacy })
    } catch (err) {
      skipped.push({ recordingId, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  // A file can still vanish between the draft and the queue; the queue says so.
  const refused = requests.length > 0 ? enqueueMany(requests) : []
  skipped.push(...refused)

  const queued = requests.length - refused.length
  log.info('Batch upload requested', { asked: recordingIds.length, queued, skipped: skipped.length })

  return { queued, skipped }
}
