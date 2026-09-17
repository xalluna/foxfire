import { shell } from 'electron'
import { rmSync } from 'node:fs'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
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
  getRecordings,
  markRecordingUnmatched
} from '../db/repositories/recordings.repo'
import {
  BIND_RETRY_HORIZON_MS,
  findMatchForRecording,
  shouldGiveUpBinding,
  type MatchCandidate
} from '../capture/matchBinding'
import { getCaptureSettings } from './captureSettings'
import type { Recording, RecordingDetail, RecordingDiskUsage } from '@shared/types'

const log = createLogger('recordings')

export function broadcastRecordingsChanged(): void {
  broadcast(CH.recordings.changed)
}

export function listRecordings(accountId: number): Recording[] {
  return getRecordings(getDb(), accountId)
}

export function getRecordingDetail(recordingId: number): RecordingDetail | null {
  const db = getDb()
  const recording = getRecording(db, recordingId)
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

/** Deletes the row and the file it points at. */
export function removeRecording(recordingId: number): void {
  const path = deleteRecording(getDb(), recordingId)
  if (path) {
    try {
      rmSync(path, { force: true })
    } catch (err) {
      // The row is already gone, so the recording has left the app either way.
      // A file locked by a player still open on it is the usual cause.
      log.debug('Could not delete recording file', { path, error: String(err) })
    }
  }
  broadcastRecordingsChanged()
}

/** The one-click cleanup offered when the advisory cap is crossed. */
export function removeOldestRecordings(accountId: number, count: number): number {
  const ids = getOldestRecordingIds(getDb(), accountId, count)
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
  taken: number
}

/**
 * Matches finished around the same time as any pending recording.
 *
 * Scoped by time in SQL rather than loading the account's whole history: a
 * long-standing library is thousands of matches and the fingerprint only ever
 * looks at the last few hours.
 */
function candidatesFor(accountId: number, since: number, until: number): MatchCandidate[] {
  const account = getAccountById(getDb(), accountId)
  if (!account) return []

  const rows = getDb()
    .prepare(
      `SELECT m.match_id, m.game_creation, m.game_duration,
              (SELECT group_concat(p2.champion_id)
                 FROM match_participants p2 WHERE p2.match_id = m.match_id) AS champion_ids,
              p.champion_id AS self_champion_id,
              EXISTS (SELECT 1 FROM recordings r WHERE r.match_id = m.match_id) AS taken
         FROM matches m
         JOIN match_participants p ON p.match_id = m.match_id AND p.puuid = ?
        WHERE m.game_creation BETWEEN ? AND ?`
    )
    .all(account.puuid, since, until) as unknown as CandidateRow[]

  return rows.map((row) => ({
    matchId: row.match_id,
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    championIds: row.champion_ids
      ? row.champion_ids.split(',').map((id) => Number(id))
      : [],
    selfChampionId: row.self_champion_id,
    taken: row.taken === 1
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
export function bindPendingRecordings(accountId: number, options: BindOptions = {}): number {
  const { allowGiveUp = false } = options
  const db = getDb()
  const now = Date.now()
  const pending = getBindableRecordings(db, accountId, now - BIND_RETRY_HORIZON_MS)
  if (pending.length === 0) return 0

  const oldest = Math.min(...pending.map((recording) => recording.startedAt))
  const candidates = candidatesFor(
    accountId,
    oldest - CANDIDATE_WINDOW_MS,
    now + CANDIDATE_WINDOW_MS
  )

  let bound = 0
  const claimed = new Set<string>()

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
      bound += 1
      log.info('Bound recording to match', {
        recordingId: recording.id,
        matchId: result.matchId,
        confidence: result.confidence
      })
    } else if (allowGiveUp && shouldGiveUpBinding(recording, now)) {
      markRecordingUnmatched(db, recording.id)
      log.info('Recording left unmatched; keeping the footage', { recordingId: recording.id })
    }
  }

  if (bound > 0) broadcastRecordingsChanged()
  return bound
}
