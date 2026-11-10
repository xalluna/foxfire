import type { UploadHold } from '@shared/types'

/**
 * The upload queue's decisions, pure so they are tested apart from the
 * database, the network and the clock.
 */

/** What the queue knows about the world when it asks whether to run. */
export interface HoldFacts {
  /** Signed in to a server at all. */
  serverMode: boolean
  /** That server keeps recordings — has Foxfire Media. */
  recordings: boolean
  /** The server everything is going to, as `server_key` spells it. Null in local-only mode. */
  activeServer: string | null
  /** From champ select until the game's stats are in — see lcu/gameflow.ts. */
  gameOn: boolean
  /** A recorder is rolling. */
  recording: boolean
  /** The server said its storage is full, and that is not stale yet. */
  serverFull: boolean
  /** Somebody pressed Pause all. */
  pausedByHand: boolean
}

/**
 * Why nothing may upload right now, or null.
 *
 * A game first, because that is what somebody notices: an upload competing
 * with the game for upstream is lag in a teamfight, and one competing with the
 * recorder for the disk is a stutter in the footage. Then the server: nothing
 * goes anywhere without a server to mint the token, and one with no Foxfire
 * Media has nowhere to put it.
 */
export function holdFor(facts: HoldFacts): UploadHold | null {
  if (facts.pausedByHand) return 'paused'
  if (facts.gameOn || facts.recording) return 'game'
  if (!facts.serverMode || facts.activeServer === null) return 'local_only'
  if (!facts.recordings) return 'no_recordings'
  if (facts.serverFull) return 'server_full'
  return null
}

/**
 * Whether one upload may run on the server the app is on now. One queued for
 * another server waits for it to be active again — its token can only come
 * from there, and its game is that server's.
 */
export function belongsHere(jobServer: string, activeServer: string | null): boolean {
  return activeServer !== null && jobServer === activeServer
}

/** Why an upload is waiting, in words, for its row. */
export function describeHold(hold: UploadHold | 'other_server'): string {
  switch (hold) {
    case 'paused':
      return 'Paused. Resume uploads to carry on.'
    case 'game':
      return 'Paused while a game is on.'
    case 'local_only':
      return 'Waiting for this PC to be signed in to a server.'
    case 'no_recordings':
      return 'This server does not keep recordings.'
    case 'server_full':
      return "The server's video storage is full. Its host has to make room."
    case 'other_server':
      return 'Waiting for the server it was queued for.'
  }
}

/** The file as it was when it was queued, and as it is now. */
export interface FileFacts {
  queuedBytes: number | null
  queuedMtime: number | null
  /** Null when the file is no longer there. */
  nowBytes: number | null
  nowMtime: number | null
}

/**
 * Whether a recording's file may be deleted now that its upload is done.
 *
 * Only when that was asked for, only once the server says the video is ready —
 * not merely uploaded: a file Foxfire Media cannot process is worth keeping —
 * and only when the file is the one that was sent. A file that changed since
 * it was queued (a recording re-filed, rewritten) is not the one on the
 * server, and stays.
 */
export function mayDeleteAfterUpload(
  deleteAfter: boolean,
  serverStatus: string,
  file: FileFacts
): { delete: true } | { delete: false; reason: string | null } {
  if (!deleteAfter) return { delete: false, reason: null }
  if (serverStatus !== 'ready') return { delete: false, reason: 'The server does not have it ready yet.' }
  if (file.nowBytes === null) return { delete: false, reason: null }
  if (file.queuedBytes !== file.nowBytes || file.queuedMtime !== file.nowMtime) {
    return { delete: false, reason: 'The file changed after it was uploaded, so it was kept.' }
  }
  return { delete: true }
}

/** How long a server's "full" holds the queue before it is asked again. */
export const FULL_RETRY_MS = 30 * 60_000

/** How often a sent upload is asked about while the server processes it, and the most it waits between asks. */
export const PROCESSING_POLL_MS = 10_000
export const PROCESSING_POLL_CAP_MS = 2 * 60_000

/** The next wait while processing: ten seconds, growing to two minutes. */
export function processingPollMs(attempt: number): number {
  return Math.min(PROCESSING_POLL_MS * 1.5 ** Math.max(0, attempt), PROCESSING_POLL_CAP_MS)
}
