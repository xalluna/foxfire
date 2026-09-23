import { existsSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { getDb } from '../db'
import { getRecordingIdentity, setYouTubeCopy } from '../db/repositories/recordings.repo'
import {
  enqueueUpload,
  getUpload,
  pendingUploads,
  requeueInterrupted,
  updateUpload,
  type UploadJob
} from '../db/repositories/youtubeUploads.repo'
import { onAppIconState } from '../appIcon'
import { onGameflowPhase } from '../lcu/phase'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import { youtubeClient } from './config'
import { nextPacificMidnight } from './quota'
import {
  backoffMs,
  classifyYouTubeError,
  forcedPrivate,
  networkFailure,
  type Failure
} from './resumable'
import { getQuotaResumesAt, setQuotaResumesAt } from './settings'
import { broadcastYouTubeState, uploadsHeld } from './state'
import {
  forgetAccessToken,
  getAccessToken,
  isConnected,
  YouTubeAuthLost,
  YouTubeTokenUnavailable
} from './tokens'
import { putChunk, queryOffset, startSession, YouTubeHttpError, type UploadedVideo } from './uploader'
import type { UploadRequest, YouTubePrivacy } from '@shared/types'

const log = createLogger('youtube')

/**
 * The queue of recordings going to YouTube, and the one worker that drains it.
 *
 * One upload at a time. A home connection's upstream is the bottleneck, and two
 * uploads sharing it finish no sooner than one after the other — they just
 * both take twice as long to be watchable.
 *
 * Everything is in the database (youtube_uploads), so the queue is exactly as
 * it was after a restart: an upload that was mid-chunk goes back to the queue
 * and asks YouTube how far it got. The worker only ever looks at the table.
 *
 * It holds off whenever a game is on — from champ select until the stats are
 * in — or OBS is recording, and checks between every chunk, so an upload that
 * started in the lobby stops within one chunk of the game starting.
 */

/** Past the quota reset, so a clock a little ahead of Google's does not spend a request finding out. */
const QUOTA_MARGIN_MS = 5 * 60_000

/** How often the progress bar is told about bytes. The chunks themselves are saved every time. */
const PROGRESS_BROADCAST_MS = 1_000

type FinishedListener = (recordingId: number) => void

let running = false
let stopped = false
let wake: NodeJS.Timeout | null = null
let inFlight: AbortController | null = null
let lastProgressBroadcast = 0
const finishedListeners = new Set<FinishedListener>()

/** Called once an upload is on YouTube. index.ts attaches it to the server from here. */
export function onUploadFinished(listener: FinishedListener): () => void {
  finishedListeners.add(listener)
  return () => finishedListeners.delete(listener)
}

/** The Recordings tab's rows, and Settings. Straight to the channel rather than through recordingService, which imports this. */
function broadcastRecordingsChanged(): void {
  broadcast(CH.recordings.changed)
}

function changed(): void {
  broadcastRecordingsChanged()
  broadcastYouTubeState()
}

/**
 * Starts the worker, and wakes it whenever the reason it was waiting may have gone.
 */
export function initYouTubeQueue(): void {
  requeueInterrupted(getDb(), Date.now())

  // Both directions matter: a game starting pauses between chunks (the next
  // check finds it), and a game ending is what lets the queue carry on.
  onGameflowPhase(() => {
    broadcastYouTubeState()
    kick()
  })
  onAppIconState(() => kick())

  kick()
}

/** Stops the worker for good, abandoning the chunk in flight. Its session carries on next launch. */
export function stopYouTubeQueue(): void {
  stopped = true
  if (wake) clearTimeout(wake)
  wake = null
  inFlight?.abort()
}

/** Looks for work. Cheap to call often; only one worker ever runs. */
export function kick(): void {
  if (running || stopped) return
  running = true
  void drain().finally(() => {
    running = false
    scheduleWake()
  })
}

/** Queues a recording for YouTube. Replaces a finished, failed or cancelled upload of it. */
export function enqueue(request: UploadRequest, trigger: 'manual' | 'auto' = 'manual'): void {
  insert(request, trigger, Date.now())
  log.info('Queued an upload', { recordingId: request.recordingId, trigger })
  changed()
  kick()
}

/**
 * Queues a batch, in the order given.
 *
 * Written one row at a time but announced once: fifty broadcasts, each
 * refetching the Recordings tab, would be the list redrawing itself fifty
 * times for one click. The queue works oldest-queued first, so each row is
 * stamped a millisecond after the last and the batch goes up in the order it
 * arrived. A recording that cannot be queued — its file gone since the list
 * was drawn — is reported rather than failing the rest.
 */
export function enqueueMany(
  requests: readonly UploadRequest[],
  trigger: 'manual' | 'auto' = 'manual'
): Array<{ recordingId: number; reason: string }> {
  const refused: Array<{ recordingId: number; reason: string }> = []
  const start = Date.now()

  requests.forEach((request, index) => {
    try {
      insert(request, trigger, start + index)
    } catch (err) {
      refused.push({ recordingId: request.recordingId, reason: err instanceof Error ? err.message : String(err) })
    }
  })

  log.info('Queued a batch of uploads', { queued: requests.length - refused.length, refused: refused.length })
  changed()
  kick()
  return refused
}

function insert(request: UploadRequest, trigger: 'manual' | 'auto', at: number): void {
  const db = getDb()
  const identity = getRecordingIdentity(db, request.recordingId)
  if (!identity) throw new Error('That recording is no longer on this machine.')
  if (identity.fileDeleted || !existsSync(identity.filePath)) {
    throw new Error('The video file is no longer on this disk, so there is nothing to upload.')
  }

  enqueueUpload(
    db,
    {
      recordingId: request.recordingId,
      trigger,
      title: request.title,
      description: request.description,
      privacy: request.privacy,
      fileBytes: statSync(identity.filePath).size
    },
    at
  )
}

/** Stops an upload and leaves it cancelled. The part YouTube already has is simply abandoned. */
export function cancelUpload(recordingId: number): void {
  const job = getUpload(getDb(), recordingId)
  if (!job || job.state === 'done') return
  if (runningJob === recordingId) inFlight?.abort()
  updateUpload(getDb(), recordingId, { state: 'cancelled', nextAttemptAt: null }, Date.now())
  changed()
}

/** Tries a failed upload again, from wherever YouTube got to. */
export function retryUpload(recordingId: number): void {
  const job = getUpload(getDb(), recordingId)
  if (!job || (job.state !== 'failed' && job.state !== 'cancelled')) return
  updateUpload(getDb(), recordingId, { state: 'queued', attempts: 0, nextAttemptAt: null, lastError: null }, Date.now())
  changed()
  kick()
}

let runningJob: number | null = null

/** Why nothing may run right now, or null. */
function heldBecause(now: number): 'unconfigured' | 'disconnected' | 'game' | 'quota' | null {
  if (!youtubeClient()) return 'unconfigured'
  if (!isConnected()) return 'disconnected'
  if (uploadsHeld()) return 'game'
  if (getQuotaResumesAt(now) !== null) return 'quota'
  return null
}

function runnable(job: UploadJob, now: number): boolean {
  return job.nextAttemptAt === null || job.nextAttemptAt <= now
}

async function drain(): Promise<void> {
  while (!stopped) {
    const now = Date.now()
    const held = heldBecause(now)
    const jobs = pendingUploads(getDb())

    if (held) {
      // Say why on every waiting row, so the Recordings tab is not a column of
      // "Queued" with no reason behind it.
      markWaiting(jobs, held)
      return
    }

    const job = jobs.find((candidate) => runnable(candidate, now))
    if (!job) return
    await upload(job)
  }
}

function markWaiting(jobs: UploadJob[], held: NonNullable<ReturnType<typeof heldBecause>>): void {
  const state = held === 'game' ? 'paused' : held === 'quota' ? 'waiting_quota' : 'waiting_auth'
  const message =
    held === 'game'
      ? 'Paused while a game is on.'
      : held === 'quota'
        ? "Waiting for YouTube's daily upload quota to come back."
        : held === 'unconfigured'
          ? 'This build of Foxfire was made without YouTube uploads.'
          : 'Connect YouTube in Settings to carry on.'

  let touched = false
  for (const job of jobs) {
    if (job.state === state && job.lastError === message) continue
    updateUpload(getDb(), job.recordingId, { state, lastError: message }, Date.now())
    touched = true
  }
  if (touched) changed()
}

/** Wakes the worker when the soonest thing it is waiting on has passed. */
function scheduleWake(): void {
  if (stopped) return
  if (wake) clearTimeout(wake)
  wake = null

  const now = Date.now()
  const times = pendingUploads(getDb())
    .map((job) => job.nextAttemptAt)
    .filter((at): at is number => at !== null && at > now)
  const quota = getQuotaResumesAt(now)
  if (quota !== null) times.push(quota)
  if (times.length === 0) return

  // Capped, because a timer set for eight hours from now is one a sleeping
  // laptop can wake past without firing.
  const delay = Math.min(Math.min(...times) - now, 15 * 60_000)
  wake = setTimeout(() => {
    wake = null
    kick()
  }, Math.max(delay, 1_000))
}

async function upload(job: UploadJob): Promise<void> {
  const db = getDb()
  const identity = getRecordingIdentity(db, job.recordingId)

  if (!identity || identity.fileDeleted || !existsSync(identity.filePath)) {
    updateUpload(db, job.recordingId, { state: 'failed', lastError: 'The video file is no longer on this disk.' }, Date.now())
    changed()
    return
  }

  const total = statSync(identity.filePath).size
  runningJob = job.recordingId
  inFlight = new AbortController()
  const signal = inFlight.signal

  updateUpload(db, job.recordingId, { state: 'uploading', lastError: null, fileBytes: total }, Date.now())
  changed()

  const file = await open(identity.filePath, 'r')
  try {
    let token = await getAccessToken()
    let offset = 0
    let session = job.sessionUri

    // Ask a session we already have how far it got, rather than trusting the
    // offset last saved: YouTube may have more, or all of it.
    if (session) {
      try {
        const answer = await queryOffset(token, session, total, signal)
        if ('done' in answer) return finish(job, answer.done)
        offset = answer.offset
      } catch (err) {
        if (err instanceof YouTubeHttpError && classifyYouTubeError(err.status, err.body).kind === 'restart') {
          session = null
        } else {
          throw err
        }
      }
    }

    if (!session) {
      session = await startSession(token, job, total, signal)
      offset = 0
      updateUpload(db, job.recordingId, { sessionUri: session, confirmedOffset: 0 }, Date.now())
    }

    while (offset < total) {
      if (stopped || signal.aborted) return
      if (uploadsHeld()) {
        updateUpload(db, job.recordingId, { state: 'paused', lastError: 'Paused while a game is on.' }, Date.now())
        changed()
        return
      }

      token = await getAccessToken()
      const answer = await putChunk(token, session, file, offset, total, signal)
      if ('done' in answer) return finish(job, answer.done)

      offset = answer.offset
      updateUpload(db, job.recordingId, { confirmedOffset: offset }, Date.now())
      // Progress goes out on the YouTube channel alone, which refreshes the
      // Recordings tab. The recordings channel refetches every match list,
      // and a match row has nothing to show for a byte count.
      if (Date.now() - lastProgressBroadcast > PROGRESS_BROADCAST_MS) {
        lastProgressBroadcast = Date.now()
        broadcastYouTubeState()
      }
    }

    // Every byte is there but the last answer was not the video — ask once more.
    const answer = await queryOffset(token, session, total, signal)
    if ('done' in answer) return finish(job, answer.done)
    throw new Error('YouTube has the whole file but did not say it made a video of it.')
  } catch (err) {
    if (signal.aborted) return
    fail(job, err)
  } finally {
    await file.close().catch(() => undefined)
    runningJob = null
    inFlight = null
  }
}

function finish(job: UploadJob, video: UploadedVideo): void {
  const db = getDb()
  const returned = video.status?.privacyStatus
  const forced = forcedPrivate(job.privacy, returned)

  setYouTubeCopy(db, job.recordingId, {
    videoId: video.id,
    privacy: (returned as YouTubePrivacy | undefined) ?? job.privacy,
    forcedPrivate: forced,
    source: 'upload',
    title: job.title,
    at: Date.now()
  })

  updateUpload(
    db,
    job.recordingId,
    {
      state: 'done',
      nextAttemptAt: null,
      confirmedOffset: job.fileBytes ?? 0,
      lastError: forced
        ? 'YouTube made this video private: Foxfire’s Google project has not passed YouTube’s review yet, so nobody else can watch it for now.'
        : null
    },
    Date.now()
  )

  log.info('Uploaded a recording to YouTube', { recordingId: job.recordingId, forcedPrivate: forced })
  changed()
  for (const listener of finishedListeners) listener(job.recordingId)
}

function fail(job: UploadJob, err: unknown): void {
  const db = getDb()
  const now = Date.now()

  if (err instanceof YouTubeAuthLost) {
    updateUpload(db, job.recordingId, { state: 'waiting_auth', lastError: err.message }, now)
    changed()
    return
  }

  const failure: Failure =
    err instanceof YouTubeHttpError
      ? classifyYouTubeError(err.status, err.body)
      : err instanceof TypeError || err instanceof YouTubeTokenUnavailable
        ? networkFailure()
        : { kind: 'fatal', message: err instanceof Error ? err.message : String(err) }

  log.info('Upload stopped', { recordingId: job.recordingId, kind: failure.kind, message: failure.message })

  switch (failure.kind) {
    case 'quota': {
      const resumesAt = nextPacificMidnight(now) + QUOTA_MARGIN_MS
      setQuotaResumesAt(resumesAt)
      updateUpload(db, job.recordingId, { state: 'waiting_quota', lastError: failure.message, nextAttemptAt: resumesAt }, now)
      break
    }
    case 'auth':
    case 'restart': {
      // A token Google refused that looked live, or a session it forgot. Once
      // straight away — with a fresh token, or a fresh session — and after
      // that a backoff like any other, so a refusal that keeps coming back
      // is not asked again in a tight loop.
      if (failure.kind === 'auth') forgetAccessToken()
      const attempts = job.attempts + 1
      updateUpload(
        db,
        job.recordingId,
        {
          state: 'queued',
          attempts,
          nextAttemptAt: attempts > 1 ? now + backoffMs(attempts) : null,
          lastError: failure.message,
          ...(failure.kind === 'restart' ? { sessionUri: null, confirmedOffset: 0 } : {})
        },
        now
      )
      break
    }
    case 'backoff': {
      const attempts = job.attempts + 1
      updateUpload(
        db,
        job.recordingId,
        { state: 'queued', attempts, nextAttemptAt: now + backoffMs(attempts), lastError: failure.message },
        now
      )
      break
    }
    case 'fatal':
      updateUpload(db, job.recordingId, { state: 'failed', lastError: failure.message, nextAttemptAt: null }, now)
      break
  }

  changed()
}
