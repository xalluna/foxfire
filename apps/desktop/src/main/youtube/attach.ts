import { ServerError } from '@foxfire/core/server'
import { isYouTubeVideoId } from '@foxfire/core/youtube'
import { serverBacked } from '../api'
import { getDb } from '../db'
import {
  attachCandidates,
  recordAttachment
} from '../db/repositories/recordingAttachments.repo'
import {
  getRecordingEvents,
  getRecordingIdentity,
  setYouTubeCopy
} from '../db/repositories/recordings.repo'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { authedRequest, getServerState, isServerMode } from '../services/serverService'
import { createLogger } from '../telemetry/logger'
import { planAttachments, serverAccountFor, type AttachPlan } from './attachPlan'
import { cancelUpload } from './queue'
import type { AttachRecordingInput, AttachRecordingOutcome } from '@shared/types'

const log = createLogger('youtube')

/**
 * Telling a server about a recording's video.
 *
 * A video on YouTube is only half of what a server needs: it also takes the
 * markers, which live in this machine's database and nowhere else. So the
 * desktop that recorded the game is the one that attaches it, and does so
 * whenever the pieces come together — an upload finishing, a recording finding
 * its match, a sync, signing in to a server — rather than at one moment that
 * might be the wrong one.
 */

function notify(): void {
  broadcast(CH.recordings.changed)
}

function inputFor(recordingId: number, replace: boolean): AttachRecordingInput | null {
  const db = getDb()
  const identity = getRecordingIdentity(db, recordingId)
  if (!identity?.youtubeVideoId) return null

  return {
    youtubeVideoId: identity.youtubeVideoId,
    source: identity.youtubeSource ?? 'upload',
    privacy: identity.youtubePrivacy,
    title: identity.youtubeTitle,
    durationSeconds: identity.durationSeconds,
    events: getRecordingEvents(db, recordingId),
    replace
  }
}

/**
 * Attaches one recording's video to one account's game on the active server.
 *
 * What the server says is written down against this server, so the reconcile
 * pass knows not to ask again: attached, refused as not yours, or refused
 * because the game already has one — the last of which the Recordings tab
 * offers to replace. A failure that says nothing about the recording — the
 * server unreachable — writes nothing, and the next pass tries again.
 */
async function attachTo(plan: AttachPlan, serverKey: string): Promise<AttachRecordingOutcome> {
  const input = inputFor(plan.recordingId, plan.replace)
  if (!input) return { ok: false, reason: 'failed', message: 'That recording has no video on YouTube.' }

  const record = (state: 'attached' | 'conflict' | 'not_owner' | 'failed', message: string | null): void =>
    recordAttachment(
      getDb(),
      {
        recordingId: plan.recordingId,
        serverKey,
        riotAccountId: plan.riotAccountId,
        matchId: plan.matchId,
        videoId: plan.videoId,
        state,
        message
      },
      Date.now()
    )

  try {
    await authedRequest(
      `/riot-accounts/${encodeURIComponent(plan.riotAccountId)}/matches/${encodeURIComponent(plan.matchId)}/recording`,
      { method: 'PUT', body: input }
    )
    record('attached', null)
    log.info('Attached a recording to the server', { recordingId: plan.recordingId, matchId: plan.matchId })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (err instanceof ServerError) {
      // The route itself is missing: a server built without recordings, or one
      // from before them. That says nothing about this recording, so nothing is
      // written — a 'failed' row would keep it off the server for good, even
      // after the host turns recordings on.
      if (err.code === 'not_found') {
        log.debug('The server has no recordings to attach to', { recordingId: plan.recordingId })
        return { ok: false, reason: 'failed', message: 'This server does not take recordings.' }
      }
      if (err.code === 'recording_exists') {
        record('conflict', message)
        return { ok: false, reason: 'exists', message }
      }
      if (err.code === 'not_your_account') {
        record('not_owner', message)
        return { ok: false, reason: 'failed', message }
      }
      if (err.status === 400 || err.status === 404) {
        record('failed', message)
        return { ok: false, reason: 'failed', message }
      }
    }

    log.debug('Could not attach a recording; will try again', { recordingId: plan.recordingId, error: message })
    return { ok: false, reason: 'failed', message }
  } finally {
    notify()
  }
}

let reconciling: Promise<void> | null = null

/**
 * Attaches every recording the active server should have and has not been told about.
 *
 * Run when anything that decides the answer changes: an upload finishing, a
 * recording finding its match, a sync, signing in. Only ever one pass at a
 * time — a second call while one runs waits for that one.
 */
export function reconcileAttachments(): Promise<void> {
  reconciling ??= (async () => {
    try {
      if (!isServerMode()) return
      const serverKey = getServerState().activeUrl
      if (!serverKey) return

      const candidates = attachCandidates(getDb(), serverKey)
      if (candidates.length === 0) return

      // Yours only, which is all planAttachments would keep: nobody else's
      // account takes a recording from this PC.
      const accounts = await serverBacked().accounts.mine()
      for (const plan of planAttachments(candidates, accounts)) {
        await attachTo(plan, serverKey)
      }
    } catch (err) {
      log.debug('Reconciling recordings with the server failed', { error: String(err) })
    } finally {
      reconciling = null
    }
  })()
  return reconciling
}

/**
 * Attaches this recording's video to its game on the active server now,
 * replacing whatever the game has — the Recordings tab's answer to a conflict,
 * and what a pasted link does when somebody said yes to replacing.
 */
export async function reattach(recordingId: number, replace = true): Promise<AttachRecordingOutcome> {
  if (!isServerMode()) return { ok: true }
  const serverKey = getServerState().activeUrl
  const identity = getRecordingIdentity(getDb(), recordingId)
  if (!serverKey || !identity?.youtubeVideoId) return { ok: true }

  // Nothing to attach it to until the recording finds its game. The link is
  // kept, and the reconcile after the bind does the rest.
  if (!identity.matchId) return { ok: true }

  const accounts = await serverBacked().accounts.mine()
  const account = serverAccountFor(identity, accounts)
  if (!account || account.isMine !== true) {
    return {
      ok: false,
      reason: 'failed',
      message: 'Only whoever claimed this League account on the server can attach its recordings.'
    }
  }

  return attachTo(
    {
      recordingId,
      riotAccountId: account.id,
      matchId: identity.matchId,
      videoId: identity.youtubeVideoId,
      replace
    },
    serverKey
  )
}

/**
 * Attaches a video somebody uploaded themselves to a recording on this disk.
 *
 * Kept on the recording first, which is what lets it play from YouTube here
 * whatever the server says; then the server is told, with this recording's
 * markers. An upload of the same recording still on its way is cancelled —
 * the link is the video now.
 */
export async function attachLink(
  recordingId: number,
  videoId: string,
  replace: boolean
): Promise<AttachRecordingOutcome> {
  if (!isYouTubeVideoId(videoId)) return { ok: false, reason: 'failed', message: 'That is not a YouTube video.' }
  if (!getRecordingIdentity(getDb(), recordingId)) {
    return { ok: false, reason: 'failed', message: 'That recording is no longer on this machine.' }
  }

  cancelUpload(recordingId)
  setYouTubeCopy(getDb(), recordingId, {
    videoId,
    privacy: null,
    forcedPrivate: false,
    source: 'link',
    title: null,
    at: Date.now()
  })
  notify()

  return reattach(recordingId, replace)
}
