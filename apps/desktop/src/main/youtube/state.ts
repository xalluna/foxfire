import { getAppIconState } from '../appIcon'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { isUploadQuietPhase } from '../lcu/gameflow'
import { getGameflowPhase } from '../lcu/phase'
import { youtubeClient } from './config'
import { getConnectedEmail, getQuotaResumesAt } from './settings'
import { isConnected } from './tokens'
import type { YouTubeState } from '@shared/types'

/**
 * The Google connection and the queue, as one answer for Settings and the
 * Recordings tab — so the two cannot disagree about whether uploads are
 * running.
 */
let connecting = false
let lastError: string | null = null

/**
 * Whether uploads should hold off right now.
 *
 * A game from champ select on, or OBS recording one: the upload would compete
 * with the game for somebody's upstream, or with OBS for their disk.
 */
export function uploadsHeld(): boolean {
  return isUploadQuietPhase(getGameflowPhase()) || getAppIconState() === 'recording'
}

export function youTubeState(): YouTubeState {
  return {
    configured: youtubeClient() !== null,
    email: isConnected() ? getConnectedEmail() : null,
    connecting,
    error: lastError,
    pausedForGame: uploadsHeld(),
    quotaResumesAt: getQuotaResumesAt()
  }
}

export function setConnecting(value: boolean): void {
  connecting = value
  broadcastYouTubeState()
}

export function setYouTubeError(message: string | null): void {
  lastError = message
  broadcastYouTubeState()
}

export function broadcastYouTubeState(): void {
  broadcast(CH.youtube.changed, youTubeState())
}
