import type { Account } from '@foxfire/core'
import type { AttachCandidateRow } from '../db/repositories/recordingAttachments.repo'

/** One recording's video to put on one account's game on the active server. */
export interface AttachPlan {
  recordingId: number
  riotAccountId: string
  matchId: string
  videoId: string
  /**
   * The server was told about an earlier video of this recording, and this is
   * a new one — a fresh upload, or a link pasted over it — so it replaces what
   * is there rather than asking.
   */
  replace: boolean
}

/** The account on the server a recording belongs to: its own id, or failing that its Riot ID. */
export function serverAccountFor(
  candidate: Pick<AttachCandidateRow, 'accountId' | 'riotId'>,
  accounts: readonly Account[]
): Account | null {
  const byId = accounts.find((account) => account.id === candidate.accountId)
  if (byId) return byId

  // Recorded in local-only mode, or on another server: the id means nothing
  // here, and the Riot ID is what still names the player.
  const riotId = candidate.riotId?.toLowerCase()
  if (!riotId) return null
  return accounts.find((account) => `${account.gameName}#${account.tagLine}`.toLowerCase() === riotId) ?? null
}

/**
 * Which recordings' videos the active server should be told about.
 *
 * Only the account's owner can attach one, so only accounts this server says
 * are yours. And only a video the server has not been told about: a recording
 * with a row for this server already was attached — or refused, or somebody
 * took it off since — and doing it again on every sync would undo a removal
 * that was the whole point. A different video than the one on record is new,
 * and replaces it.
 */
export function planAttachments(
  candidates: readonly AttachCandidateRow[],
  accounts: readonly Account[]
): AttachPlan[] {
  const plans: AttachPlan[] = []

  for (const candidate of candidates) {
    if (candidate.attachedVideoId === candidate.videoId) continue

    const account = serverAccountFor(candidate, accounts)
    if (!account || account.isMine !== true) continue

    plans.push({
      recordingId: candidate.recordingId,
      riotAccountId: account.id,
      matchId: candidate.matchId,
      videoId: candidate.videoId,
      replace: candidate.attachedVideoId !== null
    })
  }

  return plans
}
