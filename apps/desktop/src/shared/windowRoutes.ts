import { rankQueueParam } from '@foxfire/core/routes'
import type { QueueType } from './types'

/**
 * Where each window other than the main one lives in the renderer's route
 * table — renderer/src/router.tsx.
 *
 * The main process opens every window at one of these, and the harness that
 * runs the renderer in a browser navigates to them in place of opening one, so
 * both build the address here rather than each spelling it out.
 */
export const windowRoutes = {
  telemetry: (): string => '/telemetry',

  archives: (): string => '/archives',

  recording: (recordingId: number): string => `/recording/${recordingId}`,

  /**
   * A recording this machine has no file of — somebody else's, or its own
   * after the file was deleted — played from YouTube through the server.
   * Named by the account and the game, which is what a server keys it on.
   */
  remoteRecording: (accountId: string, matchId: string): string =>
    `/recording/match/${encodeURIComponent(accountId)}/${encodeURIComponent(matchId)}`,

  lpEditor: (accountId: string, queueType: QueueType, matchId: string): string => {
    const query = new URLSearchParams({
      account: accountId,
      queue: rankQueueParam(queueType),
      match: matchId
    })
    return `/lp-editor?${query}`
  }
}
