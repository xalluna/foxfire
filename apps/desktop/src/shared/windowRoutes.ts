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

  lpEditor: (accountId: string, queueType: QueueType, matchId: string): string => {
    const query = new URLSearchParams({
      account: accountId,
      queue: rankQueueParam(queueType),
      match: matchId
    })
    return `/lp-editor?${query}`
  }
}
