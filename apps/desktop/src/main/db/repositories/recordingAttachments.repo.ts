import type { DatabaseSync } from 'node:sqlite'
import type { AttachmentState } from '@shared/types'

/**
 * Which servers have been told about a recording's video.
 *
 * The reconcile pass reads this to decide what to attach, and it attaches
 * only what has no row for the active server. That is what keeps a removal on
 * the server a removal: the row stays behind saying it was attached, so the
 * next sync does not put the recording straight back.
 */
export interface AttachmentRecord {
  recordingId: number
  serverKey: string
  riotAccountId: string
  matchId: string
  videoId: string
  state: AttachmentState
  message: string | null
}

export function recordAttachment(db: DatabaseSync, record: AttachmentRecord, now: number): void {
  db.prepare(
    `INSERT INTO recording_attachments
       (recording_id, server_key, riot_account_id, match_id, video_id, state, message, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(recording_id, server_key) DO UPDATE SET
       riot_account_id = excluded.riot_account_id, match_id = excluded.match_id,
       video_id = excluded.video_id, state = excluded.state, message = excluded.message,
       updated_at = excluded.updated_at`
  ).run(
    record.recordingId,
    record.serverKey,
    record.riotAccountId,
    record.matchId,
    record.videoId,
    record.state,
    record.message,
    now
  )
}

/** Forgets a server's attachment, so the next reconcile tries it again — after a new video, say. */
export function clearAttachment(db: DatabaseSync, recordingId: number, serverKey: string): void {
  db.prepare('DELETE FROM recording_attachments WHERE recording_id = ? AND server_key = ?').run(
    recordingId,
    serverKey
  )
}

/** A recording with a video and a game, as the reconcile pass considers it. */
export interface AttachCandidateRow {
  recordingId: number
  accountId: string
  riotId: string | null
  matchId: string
  videoId: string
  /** What this server was last told, or null for never. */
  attachedVideoId: string | null
}

/**
 * Every recording that has a video on YouTube and a game it belongs to, with
 * what the given server was last told about it.
 *
 * All of them, not only the new ones: which account on the server each belongs
 * to is decided against that server's account list, which this query cannot
 * see. The pure planner does the choosing.
 */
export function attachCandidates(db: DatabaseSync, serverKey: string): AttachCandidateRow[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.account_id, r.riot_id, r.match_id, r.youtube_video_id, a.video_id AS attached
         FROM recordings r
         LEFT JOIN recording_attachments a ON a.recording_id = r.id AND a.server_key = ?
        WHERE r.youtube_video_id IS NOT NULL
          AND r.match_id IS NOT NULL`
    )
    .all(serverKey) as unknown as Array<{
    id: number
    account_id: string
    riot_id: string | null
    match_id: string
    youtube_video_id: string
    attached: string | null
  }>

  return rows.map((row) => ({
    recordingId: row.id,
    accountId: row.account_id,
    riotId: row.riot_id,
    matchId: row.match_id,
    videoId: row.youtube_video_id,
    attachedVideoId: row.attached
  }))
}
