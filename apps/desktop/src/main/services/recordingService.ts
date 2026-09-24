import { shell } from 'electron'
import { rmSync } from 'node:fs'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import { authedRequest, getServerState, isServerMode } from './serverService'
import { getAccountById } from '../db/repositories/accounts.repo'
import {
  bindRecording,
  countMissingFiles,
  deleteRecording,
  getBindableRecordings,
  getOldestRecordingIds,
  getRecording,
  getRecordingEvents,
  getRecordingFilePath,
  getRecordingUsage,
  getRecordingIdentity,
  getRecordings,
  getUploadableRecordings,
  countRecordings,
  markFileDeleted,
  markRecordingUnmatched,
  takenMatchIds
} from '../db/repositories/recordings.repo'
import { reconcileAttachments } from '../youtube/attach'
import { onRecordingSettled } from '../youtube/autoUpload'
import { cancelUpload } from '../youtube/queue'
import { YOUTUBE_ENABLED } from '@shared/features'
import {
  BIND_RETRY_HORIZON_MS,
  findMatchForRecording,
  shouldGiveUpBinding,
  type MatchCandidate
} from '../capture/matchBinding'
import { getCaptureSettings } from './captureSettings'
import type { Page, PageOptions, Recording, RecordingDetail, RecordingDiskUsage } from '@shared/types'
import { clampPage } from '@foxfire/core'

import { accountContext } from '../api/accountContext'

const log = createLogger('recordings')

export function broadcastRecordingsChanged(): void {
  broadcast(CH.recordings.changed)
}

/** A page of an account's recordings, newest first, and how many there are. */
export async function listRecordings(accountId: string, page?: PageOptions): Promise<Page<Recording>> {
  const db = getDb()
  const account = await accountContext(accountId)
  return { items: getRecordings(db, account, clampPage(page)), total: countRecordings(db, account) }
}

/**
 * Every recording of an account's that can go to YouTube — whole, for "select
 * all". One of the two lists that grow which are not paged; see CLAUDE.md.
 */
export async function listUploadableRecordings(accountId: string): Promise<Recording[]> {
  return getUploadableRecordings(getDb(), await accountContext(accountId))
}

export function getRecordingDetail(recordingId: number): RecordingDetail | null {
  const db = getDb()
  const recording = getRecording(db, recordingId, getServerState().activeUrl)
  if (!recording) return null
  return { recording, events: getRecordingEvents(db, recordingId) }
}

export function getDiskUsage(): RecordingDiskUsage {
  const db = getDb()
  const usage = getRecordingUsage(db)
  return {
    ...usage,
    missingCount: countMissingFiles(db),
    softCapBytes: getCaptureSettings().softCapBytes
  }
}

/**
 * Deletes a recording's file, and its row unless the recording is on YouTube.
 *
 * On YouTube, the file is the only thing that goes: the row stays, with its
 * markers and its video, so the recording still plays — which is what freeing
 * the disk of a recording that is already somewhere else should mean. Forget
 * is what takes the row. Neither touches YouTube or a server.
 *
 * A build without YouTube has nothing to play one from, so there it deletes
 * the row too — what its Recordings tab says Delete does.
 */
export function removeRecording(recordingId: number): void {
  const db = getDb()
  const identity = getRecordingIdentity(db, recordingId)
  if (!identity) return

  // An upload reading the file has to stop before the file goes.
  cancelUpload(recordingId)

  if (YOUTUBE_ENABLED && identity.youtubeVideoId) {
    deleteFile(identity.filePath)
    markFileDeleted(db, recordingId, Date.now())
  } else {
    deleteFile(deleteRecording(db, recordingId))
  }
  broadcastRecordingsChanged()
}

/**
 * Forgets a recording entirely: the row, its markers and its upload.
 *
 * Offered once the file is gone. The video stays on YouTube, and a server's
 * copy stays on the server, where it belongs to that account's history now.
 */
export function forgetRecording(recordingId: number): void {
  cancelUpload(recordingId)
  deleteFile(deleteRecording(getDb(), recordingId))
  broadcastRecordingsChanged()
}

function deleteFile(path: string | null): void {
  if (!path) return
  try {
    rmSync(path, { force: true })
  } catch (err) {
    // The recording has left the app either way. A file locked by a player
    // still open on it is the usual cause.
    log.debug('Could not delete recording file', { path, error: String(err) })
  }
}

/** The one-click cleanup offered when the advisory cap is crossed. */
export async function removeOldestRecordings(accountId: string, count: number): Promise<number> {
  const ids = getOldestRecordingIds(getDb(), await accountContext(accountId), count)
  for (const id of ids) removeRecording(id)
  return ids.length
}

export function revealRecording(recordingId: number): void {
  const path = getRecordingFilePath(getDb(), recordingId)
  if (path) shell.showItemInFolder(path)
}

interface CandidateRow {
  match_id: string
  game_creation: number
  game_duration: number
  champion_ids: string
  self_champion_id: number | null
}

/**
 * Matches finished around the same time as any pending recording.
 *
 * Scoped by time rather than by loading the account's whole history: a
 * long-standing library is thousands of matches and the fingerprint only ever
 * looks at the last few hours.
 *
 * Whether a match is already spoken for is decided here in both modes, and not
 * by whoever supplied the candidates. A recording is a file on this disk; a
 * server has no idea one exists, and in local-only mode asking the same
 * question twice in one query was only ever a convenience.
 */
async function candidatesFor(
  accountId: string,
  since: number,
  until: number
): Promise<MatchCandidate[]> {
  const found = isServerMode()
    ? await serverCandidates(accountId, since, until)
    : localCandidates(accountId, since, until)

  if (found.length === 0) return []

  const taken = takenMatchIds(
    getDb(),
    found.map((candidate) => candidate.matchId)
  )

  return found.map((candidate) => ({ ...candidate, taken: taken.has(candidate.matchId) }))
}

/** The same question, asked of the server that holds the matches. */
async function serverCandidates(
  accountId: string,
  since: number,
  until: number
): Promise<Omit<MatchCandidate, 'taken'>[]> {
  try {
    return await authedRequest<Omit<MatchCandidate, 'taken'>[]>(
      `/riot-accounts/${accountId}/bind-candidates?sinceMs=${since}&untilMs=${until}`
    )
  } catch (err) {
    // A server that cannot be reached leaves the recordings pending, which is
    // exactly where they were. Nothing is written off on a pass that could not
    // look — see allowGiveUp.
    log.debug('Could not ask the server for binding candidates', { error: String(err) })
    return []
  }
}

/** The same question, asked of this machine's own matches. */
function localCandidates(
  accountId: string,
  since: number,
  until: number
): Omit<MatchCandidate, 'taken'>[] {
  const account = getAccountById(getDb(), Number(accountId))
  if (!account) return []

  const rows = getDb()
    .prepare(
      `SELECT m.match_id, m.game_creation, m.game_duration,
              (SELECT group_concat(p2.champion_id)
                 FROM match_participants p2 WHERE p2.match_id = m.match_id) AS champion_ids,
              p.champion_id AS self_champion_id
         FROM matches m
         JOIN match_participants p ON p.match_id = m.match_id AND p.puuid = ?
        WHERE m.game_creation BETWEEN ? AND ?`
    )
    .all(account.puuid, since, until) as unknown as CandidateRow[]

  return rows.map((row) => ({
    matchId: row.match_id,
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    championIds: row.champion_ids ? row.champion_ids.split(',').map((id) => Number(id)) : [],
    selfChampionId: row.self_champion_id
  }))
}

/** Widened either side of the recording so clock differences cannot exclude the game. */
const CANDIDATE_WINDOW_MS = 6 * 60 * 60 * 1000

export interface BindOptions {
  /**
   * Whether a recording that still found nothing may be written off.
   *
   * Off by default, so a caller that cannot vouch for the state of the sync can
   * only ever bind. Writing off is the one irreversible-feeling thing this pass
   * does, and it is only honest when the candidates it searched were complete.
   */
  allowGiveUp?: boolean
}

/**
 * Tries to give every finished recording its match.
 *
 * Called whenever a sync finishes, because that is when a new match can first
 * appear — and, just as importantly, because a sync that imported nothing new
 * may still be the first one to run since the matches arrived.
 *
 * Recordings that have waited past the whole retry schedule are marked
 * unmatched — a resting state, not a deletion: a Practice Tool game has no
 * match-v5 match and never will, and the footage is still worth keeping. That
 * only happens when the caller passes `allowGiveUp`, which it should do only
 * for a sync that landed everything it went looking for.
 */
export async function bindPendingRecordings(
  accountId: string,
  options: BindOptions = {}
): Promise<number> {
  const { allowGiveUp = false } = options
  const db = getDb()
  const now = Date.now()
  const account = await accountContext(accountId)
  const pending = getBindableRecordings(db, account, now - BIND_RETRY_HORIZON_MS)
  if (pending.length === 0) return 0

  const oldest = Math.min(...pending.map((recording) => recording.startedAt))
  const candidates = await candidatesFor(
    accountId,
    oldest - CANDIDATE_WINDOW_MS,
    now + CANDIDATE_WINDOW_MS
  )

  let bound = 0
  const claimed = new Set<string>()
  const settled: number[] = []

  for (const recording of pending) {
    const result = findMatchForRecording(recording,
      // A match bound earlier in this same pass is off the table too, or two
      // back-to-back games on the same champion could both take the first one.
      candidates.map((candidate) =>
        claimed.has(candidate.matchId) ? { ...candidate, taken: true } : candidate
      )
    )

    if (result) {
      bindRecording(db, recording.id, result.matchId)
      claimed.add(result.matchId)
      settled.push(recording.id)
      bound += 1
      log.info('Bound recording to match', {
        recordingId: recording.id,
        matchId: result.matchId,
        confidence: result.confidence
      })
    } else if (allowGiveUp && shouldGiveUpBinding(recording, now)) {
      markRecordingUnmatched(db, recording.id)
      settled.push(recording.id)
      log.info('Recording left unmatched; keeping the footage', { recordingId: recording.id })
    }
  }

  if (bound > 0) broadcastRecordingsChanged()

  // A recording that now knows its game can go to YouTube by itself, if that
  // is turned on, and one already there can be attached on the server.
  if (YOUTUBE_ENABLED) {
    for (const id of settled) void onRecordingSettled(id)
    if (bound > 0) void reconcileAttachments()
  }

  return bound
}
