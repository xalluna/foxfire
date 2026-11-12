import { existsSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Account } from '@foxfire/core'
import { ServerError } from '@foxfire/core/server'
import { getDb } from '../db'
import { getBoolSetting, setBoolSetting } from '../db/repositories/appSettings.repo'
import {
  getRecordingEvents,
  getRecordingIdentity,
  getUploadableRecordingIds,
  markFileDeleted,
  setServerCopy
} from '../db/repositories/recordings.repo'
import {
  enqueueUpload,
  getUpload,
  pendingUploads,
  requeueInterrupted,
  updateUpload,
  uploadTotals,
  type UploadJob
} from '../db/repositories/mediaUploads.repo'
import { onAppIconState } from '../appIcon'
import { onGameflowPhase } from '../lcu/phase'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { onServerRecordingChanged } from '../server/hub'
import { getServerState, isServerMode, onServerState, serverApi } from '../services/serverService'
import { createLogger } from '../telemetry/logger'
import { describeSkip, planBulkUpload, type BulkCandidate } from './bulkPlan'
import { deleteRecordingFile } from './files'
import {
  belongsHere,
  describeHold,
  FULL_RETRY_MS,
  holdFor,
  mayDeleteAfterUpload,
  processingPollMs
} from './rules'
import { serverAccountFor } from './serverAccount'
import { getMediaSettings } from './settings'
import { gameOrRecording } from './state'
import { titleFor } from './titles'
import { createUpload, queryOffset, sendChunk, TusHttpError } from './tus'
import { backoffMs, classifyTusStatus, networkFailure, rateFrom, type TusFailure } from './tusProtocol'
import { clearUploadToken, loadUploadToken, saveUploadToken } from './uploadTokens'
import type { BulkUploadResult, EnqueueOptions, UploadHold, UploadQueueState, UploadTrigger } from '@shared/types'
import { isUploadPending } from '@shared/uploadEligibility'

const log = createLogger('media')

/**
 * The queue of recordings going to the server, and the one worker that drains it.
 *
 * One upload at a time. A home connection's upstream is the bottleneck, and two
 * uploads sharing it finish no sooner than one after the other — they just
 * both take twice as long to be watchable. That holds for one recording and for
 * a backlog of five hundred gigabytes alike: a batch is rows in this queue,
 * each minted its token only when its turn comes, because a token has to start
 * its upload within a quarter of an hour.
 *
 * The bytes never touch the server this PC is signed in to. It mints a ticket
 * — where on Foxfire Media to send the file, and a one-time token — and the
 * file goes straight there over tus. The server hears from Foxfire Media when
 * it is ready, and this PC hears from the server.
 *
 * Everything is in the database (media_uploads) but the token, which is in the
 * secret store; so the queue is as it was after a restart. An upload that was
 * mid-chunk goes back to the queue and asks Foxfire Media how far it got —
 * which works while Foxfire Media still has it: ten minutes without a byte and
 * it lets the upload go, and this starts it again from the beginning.
 */

const PROGRESS_BROADCAST_MS = 1_000

/** Asked again when a token could not be had because an upload of it is running somewhere: after Foxfire Media lets that one go. */
const IN_PROGRESS_RETRY_MS = 11 * 60_000

const PAUSED_KEY = 'media.paused'

let running = false
let stopped = false
let wake: NodeJS.Timeout | null = null
let inFlight: AbortController | null = null
let runningJob: number | null = null
let lastProgressBroadcast = 0
let serverFullUntil = 0
let samples: Array<{ at: number; bytes: number }> = []
let current: UploadQueueState['current'] = null

function changed(rows = true): void {
  if (rows) broadcast(CH.recordings.changed)
  broadcast(CH.media.changed, queueState())
}

/** Starts the worker, and wakes it whenever the reason it was waiting may have gone. */
export function initMediaQueue(): void {
  requeueInterrupted(getDb(), Date.now())

  // Both directions matter: a game starting pauses between chunks (the next
  // check finds it), and a game ending is what lets the queue carry on.
  onGameflowPhase(() => {
    changed(false)
    kick()
  })
  onAppIconState(() => kick())

  // A different server, or the same one now saying it keeps recordings.
  onServerState(() => {
    changed(false)
    kick()
  })

  // The server heard from Foxfire Media about one of ours: look now rather
  // than at the next poll.
  onServerRecordingChanged(({ matchId }) => {
    const db = getDb()
    for (const job of pendingUploads(db)) {
      if (job.state !== 'processing') continue
      if (getRecordingIdentity(db, job.recordingId)?.matchId !== matchId) continue
      updateUpload(db, job.recordingId, { nextAttemptAt: Date.now() }, Date.now())
    }
    kick()
  })

  kick()
}

/** Stops the worker for good, abandoning the chunk in flight. Foxfire Media keeps what it got for ten minutes. */
export function stopMediaQueue(): void {
  stopped = true
  if (wake) clearTimeout(wake)
  wake = null
  inFlight?.abort()
}

/** Looks for work. Cheap to call often; only one worker ever runs. */
export function kick(): void {
  if (running || stopped) return
  running = true
  void drain()
    .catch((err) => log.warn('The upload queue stopped on something unexpected', { error: String(err) }))
    .finally(() => {
      running = false
      scheduleWake()
    })
}

/* ------------------------------------------------------------------------ */
/* Queueing                                                                 */
/* ------------------------------------------------------------------------ */

function activeServer(): string | null {
  return isServerMode() ? getServerState().activeUrl : null
}

/**
 * Queues recordings for the server, oldest game first.
 *
 * The one way in, for one recording and five hundred: written one row at a
 * time and announced once, so a batch is not the list redrawing itself five
 * hundred times. Each row is stamped a millisecond after the last, so the
 * queue — which works oldest-queued first — keeps the order. What cannot go is
 * reported with why, rather than failing the rest.
 */
export function enqueue(
  recordingIds: readonly number[],
  trigger: UploadTrigger,
  options: EnqueueOptions = {}
): BulkUploadResult {
  const serverKey = activeServer()
  if (!serverKey || !getServerState().recordings) {
    return {
      queued: 0,
      queuedBytes: 0,
      skipped: recordingIds.map((recordingId) => ({
        recordingId,
        reason: serverKey ? 'This server does not keep recordings.' : 'Sign in to a server to upload recordings to it.'
      }))
    }
  }

  const db = getDb()
  const deleteAfter = options.deleteAfter ?? getMediaSettings().afterUpload === 'delete'

  const candidates = new Map<number, BulkCandidate>()
  const files = new Map<number, { bytes: number; mtime: number }>()
  for (const recordingId of recordingIds) {
    const identity = getRecordingIdentity(db, recordingId)
    if (!identity) continue
    const stat = !identity.fileDeleted && existsSync(identity.filePath) ? statSync(identity.filePath) : null
    if (stat) files.set(recordingId, { bytes: stat.size, mtime: Math.trunc(stat.mtimeMs) })
    candidates.set(recordingId, {
      recordingId,
      startedAt: identity.startedAt,
      hasFile: stat !== null,
      hasGame: identity.matchId !== null,
      onServer: identity.serverVideoKey === serverKey,
      uploadPending: isUploadPending(getUpload(db, recordingId))
    })
  }

  const plan = planBulkUpload(recordingIds, candidates)
  const start = Date.now()
  let queuedBytes = 0

  plan.queue.forEach((recordingId, index) => {
    const file = files.get(recordingId)!
    enqueueUpload(
      db,
      { recordingId, serverKey, trigger, deleteAfter, fileBytes: file.bytes, fileMtime: file.mtime },
      start + index
    )
    clearUploadToken(recordingId)
    queuedBytes += file.bytes
  })

  const skipped = plan.skipped.map(({ recordingId, reason }) => ({ recordingId, reason: describeSkip(reason) }))
  log.info('Queued uploads', { trigger, queued: plan.queue.length, queuedBytes, skipped: skipped.length, deleteAfter })

  if (plan.queue.length > 0) {
    changed()
    kick()
  }
  return { queued: plan.queue.length, queuedBytes, skipped }
}

/**
 * Every recording on this PC you could send to the server, queued at once —
 * Settings' "upload everything", for a backlog.
 *
 * Yours only: the PC may hold games somebody else played on an account they
 * claimed, and the server takes those from nobody but them. Queued anyway,
 * each would only have failed when its turn came.
 */
export async function enqueueAll(options: EnqueueOptions = {}): Promise<BulkUploadResult> {
  const serverKey = activeServer()
  const ids = serverKey ? getUploadableRecordingIds(getDb(), serverKey, await serverApi().accounts.mine()) : []
  return enqueue(ids, 'bulk', options)
}

/** What "upload everything" would queue: how many, and how big. Nothing, while the server cannot say whose accounts are yours. */
export async function backlog(): Promise<{ count: number; bytes: number }> {
  const serverKey = activeServer()
  if (!serverKey) return { count: 0, bytes: 0 }
  const mine = await serverApi()
    .accounts.mine()
    .catch(() => null)
  if (!mine) return { count: 0, bytes: 0 }
  const db = getDb()
  let bytes = 0
  const ids = getUploadableRecordingIds(db, serverKey, mine)
  for (const id of ids) {
    const path = getRecordingIdentity(db, id)?.filePath
    if (path && existsSync(path)) bytes += statSync(path).size
  }
  return { count: ids.length, bytes }
}

/** Stops an upload and leaves it cancelled. What Foxfire Media already has is let go. */
export function cancelUpload(recordingId: number): void {
  if (stopUpload(recordingId)) changed()
}

/**
 * Stops the uploads of many recordings at once — ones about to be deleted or
 * forgotten — and answers whether any was on its way. Says nothing: the caller
 * announces the whole batch once, with {@link announceQueue}, rather than the
 * list redrawing itself for every row.
 */
export function releaseUploads(recordingIds: readonly number[]): boolean {
  let any = false
  for (const recordingId of recordingIds) any = stopUpload(recordingId) || any
  return any
}

/** Tells the windows what the queue is now, after a batch of {@link releaseUploads}. */
export function announceQueue(): void {
  changed(false)
}

function stopUpload(recordingId: number): boolean {
  const job = getUpload(getDb(), recordingId)
  if (!job || job.state === 'done' || job.state === 'cancelled') return false
  if (runningJob === recordingId) inFlight?.abort()
  updateUpload(getDb(), recordingId, { state: 'cancelled', nextAttemptAt: null }, Date.now())
  clearUploadToken(recordingId)
  return true
}

/** Tries a failed or cancelled upload again. */
export function retryUpload(recordingId: number): void {
  const job = getUpload(getDb(), recordingId)
  if (!job || (job.state !== 'failed' && job.state !== 'cancelled')) return
  updateUpload(getDb(), recordingId, { state: 'queued', attempts: 0, nextAttemptAt: null, lastError: null }, Date.now())
  changed()
  kick()
}

/** Holds every upload, between chunks, until resumed — and across a restart. */
export function pauseAll(): void {
  setBoolSetting(getDb(), PAUSED_KEY, true)
  inFlight?.abort()
  changed()
}

export function resumeAll(): void {
  setBoolSetting(getDb(), PAUSED_KEY, false)
  serverFullUntil = 0
  changed()
  kick()
}

/* ------------------------------------------------------------------------ */
/* State                                                                    */
/* ------------------------------------------------------------------------ */

function currentHold(now: number): UploadHold | null {
  const state = getServerState()
  return holdFor({
    serverMode: isServerMode(),
    recordings: state.recordings,
    activeServer: activeServer(),
    gameOn: gameOrRecording(),
    recording: false,
    serverFull: serverFullUntil > now,
    pausedByHand: getBoolSetting(getDb(), PAUSED_KEY, false)
  })
}

export function queueState(): UploadQueueState {
  const now = Date.now()
  const totals = uploadTotals(getDb())
  const rate = rateFrom(samples, now)
  return {
    recordings: isServerMode() && getServerState().recordings,
    held: currentHold(now),
    current: current ? { ...current, bytesPerSecond: rate } : null,
    waiting: totals.waiting,
    processing: totals.processing,
    failed: totals.failed,
    remainingBytes: totals.remainingBytes,
    etaSeconds: rate ? Math.round(totals.remainingBytes / rate) : null
  }
}

/* ------------------------------------------------------------------------ */
/* The worker                                                               */
/* ------------------------------------------------------------------------ */

function runnable(job: UploadJob, now: number): boolean {
  return job.nextAttemptAt === null || job.nextAttemptAt <= now
}

async function drain(): Promise<void> {
  let accounts: readonly Account[] | null = null
  const mine = async (): Promise<readonly Account[]> => (accounts ??= await serverApi().accounts.mine())

  while (!stopped) {
    const now = Date.now()
    const hold = currentHold(now)
    const server = activeServer()
    const jobs = pendingUploads(getDb())

    // Asking the server whether something sent is ready costs nothing and
    // competes with no game, so it goes on through a game and a pause alike.
    const processing = jobs.find(
      (job) => job.state === 'processing' && belongsHere(job.serverKey, server) && runnable(job, now)
    )
    if (processing && (hold === null || hold === 'game' || hold === 'paused' || hold === 'server_full')) {
      await checkProcessing(processing)
      continue
    }

    const sendable = jobs.filter((job) => job.state !== 'processing')
    if (hold) {
      // Say why on every waiting row, so the Recordings tab is not a column of
      // "Queued" with no reason behind it.
      markWaiting(sendable, describeHold(hold))
      return
    }

    markWaiting(
      sendable.filter((job) => !belongsHere(job.serverKey, server)),
      describeHold('other_server')
    )

    const job = sendable.find((candidate) => belongsHere(candidate.serverKey, server) && runnable(candidate, now))
    if (!job) return

    try {
      await upload(job, mine)
    } catch (err) {
      fail(job, err)
    }
  }
}

function markWaiting(jobs: UploadJob[], message: string): void {
  let touched = false
  for (const job of jobs) {
    if (job.state === 'paused' && job.lastError === message) continue
    updateUpload(getDb(), job.recordingId, { state: 'paused', lastError: message }, Date.now())
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
  if (serverFullUntil > now) times.push(serverFullUntil)
  if (times.length === 0) return

  // Capped, because a timer set for hours from now is one a sleeping laptop
  // can wake past without firing.
  const delay = Math.min(Math.min(...times) - now, 15 * 60_000)
  wake = setTimeout(() => {
    wake = null
    kick()
  }, Math.max(delay, 1_000))
}

class MintRefused extends Error {
  constructor(
    readonly failure: TusFailure | { kind: 'in_progress'; message: string } | { kind: 'exists'; message: string },
  ) {
    super(failure.message)
  }
}

/**
 * A ticket from the server for this recording: where to send it, and the token.
 * Asked again, it carries the same video on.
 */
async function mint(job: UploadJob, mine: () => Promise<readonly Account[]>, total: number) {
  const db = getDb()
  const identity = getRecordingIdentity(db, job.recordingId)
  if (!identity?.matchId) {
    throw new MintRefused({ kind: 'fatal', message: 'It never found its game, which the server keeps a recording against.' })
  }

  const account = serverAccountFor(identity, await mine())
  if (!account) {
    throw new MintRefused({
      kind: 'fatal',
      message: 'Only whoever claimed this League account on the server can upload its recordings.'
    })
  }

  const outcome = await serverApi().matchRecordings.upload(account.id, identity.matchId, {
    title: await titleFor(job.recordingId),
    filename: basename(identity.filePath),
    sizeBytes: total,
    durationSeconds: identity.durationSeconds,
    events: getRecordingEvents(db, job.recordingId)
  })

  if (outcome.ok) return { ticket: outcome.ticket, accountId: account.id, matchId: identity.matchId }
  switch (outcome.reason) {
    case 'exists':
      throw new MintRefused({ kind: 'exists', message: outcome.message })
    case 'in_progress':
      throw new MintRefused({ kind: 'in_progress', message: outcome.message })
    case 'full':
      throw new MintRefused({ kind: 'full', message: outcome.message })
    default:
      throw new MintRefused({ kind: 'backoff', message: outcome.message })
  }
}

async function upload(job: UploadJob, mine: () => Promise<readonly Account[]>): Promise<void> {
  const db = getDb()
  const identity = getRecordingIdentity(db, job.recordingId)

  if (!identity || identity.fileDeleted || !existsSync(identity.filePath)) {
    updateUpload(db, job.recordingId, { state: 'failed', lastError: 'The video file is no longer on this disk.' }, Date.now())
    changed()
    return
  }

  const stat = statSync(identity.filePath)
  const total = stat.size
  if (job.fileBytes !== total || job.fileMtime !== Math.trunc(stat.mtimeMs)) {
    // Rewritten since it was queued: what was sent so far is of another file.
    enqueueUpload(
      db,
      {
        recordingId: job.recordingId,
        serverKey: job.serverKey,
        trigger: job.trigger,
        deleteAfter: job.deleteAfter,
        fileBytes: total,
        fileMtime: stat.mtimeMs
      },
      job.createdAt
    )
    clearUploadToken(job.recordingId)
    job = getUpload(db, job.recordingId)!
  }

  runningJob = job.recordingId
  inFlight = new AbortController()
  const signal = inFlight.signal
  samples = []
  current = { recordingId: job.recordingId, bytesSent: job.confirmedOffset, fileBytes: total, bytesPerSecond: null }

  updateUpload(db, job.recordingId, { state: 'uploading', lastError: null }, Date.now())
  changed()

  const file = await open(identity.filePath, 'r')
  try {
    let token = loadUploadToken(job.recordingId)
    let uploadUrl = job.uploadUrl
    let offset = 0

    // Ask an upload we already have how far it got, rather than trusting the
    // offset last saved: Foxfire Media may have more — or have let it go.
    if (uploadUrl && token) {
      try {
        offset = await queryOffset(uploadUrl, token, signal)
      } catch (err) {
        if (!(err instanceof TusHttpError) || classifyTusStatus(err.status, 'resume').kind !== 'renew') throw err
        uploadUrl = null
      }
    }

    if (!uploadUrl || !token) {
      const minted = await mint(job, mine, total)
      token = minted.ticket.uploadToken
      saveUploadToken(job.recordingId, token)
      uploadUrl = await createUpload(minted.ticket.uploadUrl, token, total, basename(identity.filePath), signal)
      offset = 0
      updateUpload(
        db,
        job.recordingId,
        { videoId: minted.ticket.videoId, uploadUrl, confirmedOffset: 0 },
        Date.now()
      )
      log.info('Started an upload', { recordingId: job.recordingId, videoId: minted.ticket.videoId, bytes: total })
    }

    while (offset < total) {
      if (stopped || signal.aborted) return
      const hold = currentHold(Date.now())
      if (hold) {
        updateUpload(db, job.recordingId, { state: 'paused', lastError: describeHold(hold) }, Date.now())
        changed()
        return
      }

      offset = await sendChunk(uploadUrl, token, file, offset, total, signal)
      updateUpload(db, job.recordingId, { confirmedOffset: offset }, Date.now())

      const now = Date.now()
      samples.push({ at: now, bytes: offset })
      samples = samples.filter((sample) => now - sample.at <= 60_000)
      current = { recordingId: job.recordingId, bytesSent: offset, fileBytes: total, bytesPerSecond: null }

      // Progress goes out on the media channel alone. The recordings channel
      // refetches every match list, and a match row has nothing to show for
      // a byte count.
      if (now - lastProgressBroadcast > PROGRESS_BROADCAST_MS) {
        lastProgressBroadcast = now
        changed(false)
      }
    }

    // All of it is there. The token has done its job.
    clearUploadToken(job.recordingId)
    updateUpload(
      db,
      job.recordingId,
      { state: 'processing', attempts: 0, nextAttemptAt: Date.now() + processingPollMs(0), lastError: null },
      Date.now()
    )
    log.info('Sent a recording; the server is processing it', { recordingId: job.recordingId, bytes: total })
    changed()
  } catch (err) {
    // Stopped on purpose — cancelled, paused, the app closing. Whatever did it
    // has already said what the row is now.
    if (signal.aborted) return
    throw err
  } finally {
    await file.close().catch(() => undefined)
    runningJob = null
    inFlight = null
    current = null
  }
}

/**
 * Asks the server whether a sent recording is ready, and acts on the answer:
 * ready is the server's copy, and — if asked for — the file going; failed is
 * failed; anything else is asked again later, less often each time.
 */
async function checkProcessing(job: UploadJob): Promise<void> {
  const db = getDb()
  const now = Date.now()
  const identity = getRecordingIdentity(db, job.recordingId)
  if (!identity?.matchId) {
    updateUpload(db, job.recordingId, { state: 'failed', lastError: 'The recording lost its game.' }, now)
    changed()
    return
  }

  let recording
  try {
    const account = serverAccountFor(identity, await serverApi().accounts.mine())
    recording = account ? await serverApi().matchRecordings.get(account.id, identity.matchId) : null
  } catch (err) {
    updateUpload(
      db,
      job.recordingId,
      { attempts: job.attempts + 1, nextAttemptAt: now + processingPollMs(job.attempts + 1) },
      now
    )
    log.debug('Could not ask the server about a recording', { recordingId: job.recordingId, error: String(err) })
    return
  }

  if (!recording) {
    updateUpload(db, job.recordingId, { state: 'failed', lastError: 'The server no longer has this recording.' }, now)
    changed()
    return
  }

  switch (recording.status) {
    case 'ready':
      return finishReady(job, recording.videoId)
    case 'failed':
      updateUpload(
        db,
        job.recordingId,
        { state: 'failed', lastError: recording.error ?? 'The server could not process this recording.' },
        now
      )
      log.warn('The server could not process a recording', { recordingId: job.recordingId, error: recording.error })
      changed()
      return
    case 'upload_failed':
      // Foxfire Media let the upload go after all. Send it again.
      updateUpload(db, job.recordingId, { state: 'queued', uploadUrl: null, confirmedOffset: 0, nextAttemptAt: null }, now)
      changed()
      return
    default:
      updateUpload(
        db,
        job.recordingId,
        { attempts: job.attempts + 1, nextAttemptAt: now + processingPollMs(job.attempts + 1) },
        now
      )
  }
}

function finishReady(job: UploadJob, videoId: string): void {
  const db = getDb()
  const now = Date.now()
  setServerCopy(db, job.recordingId, { videoId, serverKey: job.serverKey, at: now })

  let note: string | null = null
  const identity = getRecordingIdentity(db, job.recordingId)
  if (identity && !identity.fileDeleted) {
    const stat = existsSync(identity.filePath) ? statSync(identity.filePath) : null
    const verdict = mayDeleteAfterUpload(job.deleteAfter, 'ready', {
      queuedBytes: job.fileBytes,
      queuedMtime: job.fileMtime,
      nowBytes: stat?.size ?? null,
      nowMtime: stat ? Math.trunc(stat.mtimeMs) : null
    })

    if (verdict.delete) {
      if (deleteRecordingFile(identity.filePath)) {
        markFileDeleted(db, job.recordingId, now)
        log.info('Deleted a recording from this PC now the server has it', { recordingId: job.recordingId })
      } else {
        note = 'On the server. The file could not be deleted — something has it open.'
      }
    } else {
      note = verdict.reason
    }
  }

  updateUpload(db, job.recordingId, { state: 'done', nextAttemptAt: null, lastError: note }, now)
  log.info('A recording is ready on the server', { recordingId: job.recordingId, videoId })
  changed()
}

function fail(queued: UploadJob, err: unknown): void {
  const db = getDb()
  const now = Date.now()
  // As it is now, not as it was picked: the upload may have been created since.
  const job = getUpload(db, queued.recordingId) ?? queued

  if (err instanceof MintRefused && err.failure.kind === 'exists') {
    // The game has a recording on the server already — this one, from a run
    // that never heard back, or another. Ask after it as if it had been sent.
    updateUpload(db, job.recordingId, { state: 'processing', nextAttemptAt: now, lastError: null }, now)
    changed()
    return
  }

  if (err instanceof MintRefused && err.failure.kind === 'in_progress') {
    updateUpload(
      db,
      job.recordingId,
      { state: 'queued', nextAttemptAt: now + IN_PROGRESS_RETRY_MS, lastError: err.message },
      now
    )
    changed()
    return
  }

  const failure: TusFailure =
    err instanceof MintRefused
      ? (err.failure as TusFailure)
      : err instanceof TusHttpError
        ? classifyTusStatus(err.status, job.uploadUrl ? 'resume' : 'create')
        : err instanceof ServerError && err.status === 0
          ? networkFailure()
          : err instanceof TypeError
            ? networkFailure()
            : { kind: 'backoff', message: err instanceof Error ? err.message : String(err) }

  log.info('Upload stopped', { recordingId: job.recordingId, kind: failure.kind, message: failure.message })
  const attempts = job.attempts + 1

  switch (failure.kind) {
    case 'renew':
    case 'requery':
      // Once straight away — with a new token, or a fresh look at the offset —
      // and after that a backoff, so a refusal that keeps coming back is not
      // asked again in a tight loop.
      clearUploadToken(job.recordingId)
      updateUpload(
        db,
        job.recordingId,
        {
          state: 'queued',
          attempts,
          nextAttemptAt: attempts > 1 ? now + backoffMs(attempts) : null,
          lastError: failure.message,
          ...(failure.kind === 'renew' ? { uploadUrl: null, confirmedOffset: 0 } : {})
        },
        now
      )
      break
    case 'full':
      serverFullUntil = now + FULL_RETRY_MS
      updateUpload(db, job.recordingId, { state: 'paused', lastError: failure.message, nextAttemptAt: serverFullUntil }, now)
      break
    case 'backoff':
      updateUpload(
        db,
        job.recordingId,
        { state: 'queued', attempts, nextAttemptAt: now + backoffMs(attempts), lastError: failure.message },
        now
      )
      break
    case 'fatal':
      clearUploadToken(job.recordingId)
      updateUpload(db, job.recordingId, { state: 'failed', lastError: failure.message, nextAttemptAt: null }, now)
      break
  }

  changed()
}
