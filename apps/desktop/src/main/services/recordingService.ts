import { shell } from 'electron'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import { authedRequest, getServerState, isServerMode, offersGame, serverApi } from './serverService'
import { getAccountById } from '../db/repositories/accounts.repo'
import {
  bindRecording,
  countServerOnlyRecordings,
  deleteRecording,
  deleteRecordings,
  getBindableRecordings,
  getOldestRecordingIds,
  getRecording,
  getRecordingEvents,
  getRecordingFilePath,
  getRecordingPlayers,
  getRecordingUsage,
  getRecordingIdentity,
  getRecordings,
  getServerOnlyRecordingIds,
  getUploadableRecordings,
  countRecordings,
  markFileDeleted,
  markRecordingUnmatched,
  takenMatchIds
} from '../db/repositories/recordings.repo'
import { onRecordingSettled } from '../media/autoUpload'
import { deleteRecordingFile } from '../media/files'
import { announceQueue, releaseUploads } from '../media/queue'
import {
  BIND_RETRY_HORIZON_MS,
  findMatchForRecording,
  findTftMatchForRecording,
  shouldGiveUpBinding,
  type BindingResult,
  type MatchCandidate,
  type TftMatchCandidate
} from '../capture/matchBinding'
import type { BindableRecording } from '../db/repositories/recordings.repo'
import { getCaptureSettings } from './captureSettings'
import type {
  ForgetResult,
  Page,
  PageOptions,
  Recording,
  RecordingDetail,
  RecordingDiskUsage,
  RecordingFilter,
  RecordingPlayer
} from '@shared/types'
import { clampPage } from '@foxfire/core'

import { accountContext } from '../api/accountContext'

const log = createLogger('recordings')

export function broadcastRecordingsChanged(): void {
  broadcast(CH.recordings.changed)
}

/**
 * A page of the recordings on this PC, newest first, and how many the filter
 * leaves. Every account's: the files are on this disk whichever one is picked.
 */
export function listRecordings(page?: PageOptions, filter: RecordingFilter = {}): Page<Recording> {
  const db = getDb()
  return { items: getRecordings(db, filter, clampPage(page)), total: countRecordings(db, filter) }
}

/** The players with recordings on this PC, for the list's filter. */
export function listRecordingPlayers(): RecordingPlayer[] {
  return getRecordingPlayers(getDb())
}

/**
 * Every recording on this PC you could send to the server — whole, for
 * "select all". One of the two lists that grow which are not paged; see
 * CLAUDE.md. Yours only: the server says which accounts those are, and takes
 * an upload from nobody else.
 */
export async function listUploadableRecordings(): Promise<Recording[]> {
  const serverKey = isServerMode() && getServerState().recordings ? getServerState().activeUrl : null
  if (serverKey === null) return []
  return getUploadableRecordings(getDb(), serverKey, await serverApi().accounts.mine())
}

export function getRecordingDetail(recordingId: number): RecordingDetail | null {
  const db = getDb()
  const recording = getRecording(db, recordingId)
  if (!recording) return null
  return { recording, events: getRecordingEvents(db, recordingId) }
}

/**
 * What the recordings take up on this PC. Every figure is about the same
 * recordings — this PC's, whoever played them — as the list beneath it and
 * the cleanup the warning offers.
 */
export function getDiskUsage(): RecordingDiskUsage {
  const db = getDb()
  return {
    ...getRecordingUsage(db),
    serverOnlyCount: countServerOnlyRecordings(db),
    softCapBytes: getCaptureSettings().softCapBytes
  }
}

/**
 * Deletes a recording's file, and its row unless the recording is on a server.
 *
 * On a server, the file is the only thing that goes: the row stays, with its
 * markers and its place in the history, so the recording still plays — from
 * the server — which is what freeing the disk of a recording that is already
 * somewhere else should mean. Forget is what takes the row. Neither touches
 * the server's copy; taking that off is the row's menu's.
 */
export function removeRecording(recordingId: number): void {
  removeRecordings([recordingId])
}

/** {@link removeRecording} for many, announced once. Answers how many there were. */
function removeRecordings(recordingIds: readonly number[]): number {
  if (recordingIds.length === 0) return 0
  const db = getDb()

  // An upload reading a file has to stop before the file goes.
  const uploadsStopped = releaseUploads(recordingIds)

  let removed = 0
  for (const recordingId of recordingIds) {
    const identity = getRecordingIdentity(db, recordingId)
    if (!identity) continue
    if (identity.serverVideoId) {
      if (deleteRecordingFile(identity.filePath)) markFileDeleted(db, recordingId, Date.now())
    } else {
      deleteRecordingFile(deleteRecording(db, recordingId))
    }
    removed += 1
  }

  if (removed > 0 || uploadsStopped) broadcastRecordingsChanged()
  if (uploadsStopped) announceQueue()
  return removed
}

/**
 * Forgets a recording entirely: the row, its markers and its upload.
 *
 * Offered once the file is gone. A server's copy stays on the server, where it
 * belongs to that account's history now.
 */
export function forgetRecording(recordingId: number): void {
  forgetRecordings([recordingId])
}

/**
 * Forgets many recordings at once: each row, its markers and its upload, in
 * one transaction and one announcement — five hundred rows are not five
 * hundred redraws of the list.
 *
 * A recording whose file is still on this PC was picked by hand, and forgetting
 * it deletes the file too, as forgetting one always has: a file left behind
 * with no row would take up the disk with nothing in the app to find it by.
 * So one whose file cannot be deleted — open in a player, usually — keeps its
 * row, and is counted as kept. The server's copy of any of them stays on the
 * server, markers and all.
 */
export function forgetRecordings(recordingIds: readonly number[]): ForgetResult {
  const ids = [...new Set(recordingIds)]
  if (ids.length === 0) return { forgotten: 0, kept: 0 }
  const db = getDb()

  // An upload reading a file has to stop before the file goes, and one only
  // queued must not start on a row about to disappear.
  const uploadsStopped = releaseUploads(ids)

  const forget: number[] = []
  let kept = 0
  for (const id of ids) {
    const identity = getRecordingIdentity(db, id)
    if (!identity) continue
    // A file deleted on purpose is not looked for again.
    if (identity.fileDeleted || deleteRecordingFile(identity.filePath)) forget.push(id)
    else kept += 1
  }

  const forgotten = deleteRecordings(db, forget)
  if (forgotten > 0 || uploadsStopped) broadcastRecordingsChanged()
  if (uploadsStopped) announceQueue()
  if (ids.length > 1) log.info('Forgot recordings', { forgotten, kept })
  return { forgotten, kept }
}

/**
 * Forgets every recording that lives only on the server now: its file was
 * deleted from this PC and the server has its video. Nothing with a file
 * here is touched.
 */
export function forgetServerOnlyRecordings(): ForgetResult {
  return forgetRecordings(getServerOnlyRecordingIds(getDb()))
}

/**
 * The one-click cleanup offered when the advisory cap is crossed: the oldest
 * files on this PC, whoever's they are — the same files the size it warns
 * about adds up.
 */
export function removeOldestRecordings(count: number): number {
  return removeRecordings(getOldestRecordingIds(getDb(), count))
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

/**
 * TFT games around the pending TFT recordings: when each ran, and when the
 * account's player went out. Whether one is already spoken for is decided
 * here, as for League's.
 */
async function tftCandidatesFor(accountId: string, since: number, until: number): Promise<TftMatchCandidate[]> {
  const found = isServerMode()
    ? await serverTftCandidates(accountId, since, until)
    : localTftCandidates(accountId, since, until)

  if (found.length === 0) return []

  const taken = takenMatchIds(
    getDb(),
    found.map((candidate) => candidate.matchId)
  )
  return found.map((candidate) => ({ ...candidate, taken: taken.has(candidate.matchId) }))
}

async function serverTftCandidates(
  accountId: string,
  since: number,
  until: number
): Promise<Omit<TftMatchCandidate, 'taken'>[]> {
  // A server whose host has not turned TFT on has no TFT games to bind to, so
  // the recording stays this PC's own.
  if (!offersGame('tft')) return []

  try {
    const rows = await authedRequest<
      Array<{ matchId: string; gameCreation: number; gameDuration: number; timeEliminated: number | null }>
    >(`/riot-accounts/${accountId}/tft/bind-candidates?sinceMs=${since}&untilMs=${until}`)
    return rows.map(({ matchId, gameCreation, gameDuration, timeEliminated }) => ({
      matchId,
      gameCreation,
      gameDuration,
      timeEliminated
    }))
  } catch (err) {
    log.debug('Could not ask the server for TFT binding candidates', { error: String(err) })
    return []
  }
}

function localTftCandidates(accountId: string, since: number, until: number): Omit<TftMatchCandidate, 'taken'>[] {
  // The account's boards are under its TFT key's id while it has one, and its
  // own puuid otherwise — see services/tftIdentity.ts.
  const rows = getDb()
    .prepare(
      `SELECT m.match_id, m.game_creation, m.game_duration, p.time_eliminated
         FROM matches m
         JOIN tft_participants p ON p.match_id = m.match_id
        WHERE p.puuid = COALESCE(
                (SELECT puuid FROM account_scoped_puuids WHERE account_id = ? AND scope = 'tft'),
                (SELECT puuid FROM accounts WHERE id = ?))
          AND m.game_creation BETWEEN ? AND ?`
    )
    .all(Number(accountId), Number(accountId), since, until) as unknown as Array<{
    match_id: string
    game_creation: number
    game_duration: number
    time_eliminated: number | null
  }>

  return rows.map((row) => ({
    matchId: row.match_id,
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    timeEliminated: row.time_eliminated
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

  // Each game's recordings against that game's matches: League's by roster,
  // TFT's by the game's id or, failing that, by when it was played.
  const league = pending.filter((recording) => recording.game === 'lol')
  const tft = pending.filter((recording) => recording.game === 'tft')
  const window = (recordings: BindableRecording[]): [number, number] => [
    Math.min(...recordings.map((recording) => recording.startedAt)) - CANDIDATE_WINDOW_MS,
    now + CANDIDATE_WINDOW_MS
  ]
  const candidates = league.length > 0 ? await candidatesFor(accountId, ...window(league)) : []
  const tftCandidates = tft.length > 0 ? await tftCandidatesFor(accountId, ...window(tft)) : []

  let bound = 0
  const claimed = new Set<string>()
  const settled: number[] = []

  // A match bound earlier in this same pass is off the table too, or two
  // back-to-back games on the same champion could both take the first one.
  const unclaimed = <T extends { matchId: string; taken: boolean }>(list: T[]): T[] =>
    list.map((candidate) => (claimed.has(candidate.matchId) ? { ...candidate, taken: true } : candidate))

  for (const recording of pending) {
    const result: BindingResult | null =
      recording.game === 'tft'
        ? findTftMatchForRecording(recording, unclaimed(tftCandidates))
        : findMatchForRecording(recording, unclaimed(candidates))

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
    } else if (allowGiveUp && shouldGiveUpBinding(recording, now, recording.game)) {
      markRecordingUnmatched(db, recording.id)
      settled.push(recording.id)
      log.info('Recording left unmatched; keeping the footage', { recordingId: recording.id })
    }
  }

  if (bound > 0) broadcastRecordingsChanged()

  // A recording that now knows its game can go to the server by itself, if
  // that is turned on.
  for (const id of settled) onRecordingSettled(id)

  return bound
}
