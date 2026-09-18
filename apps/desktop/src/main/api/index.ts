import { httpApi } from './http'
import { localApi } from './local'
import { getServerState } from '../services/serverService'
import type { ServerBackedApi } from './types'

export type { ServerBackedApi } from './types'

/**
 * Whichever implementation is currently answering the renderer's reads.
 *
 * A function rather than an exported constant because of when handlers are
 * registered: once, at startup, for the life of the process. A handler that
 * closed over the value would keep answering from whatever was active the
 * moment the app booted, and connecting to a server — or disconnecting from
 * one — has to change what the next call reads, not what the next launch reads.
 *
 * So handlers call this per invoke. It is a property lookup on the far side of
 * an IPC round trip that has already crossed a process boundary.
 *
 * The condition is a signed-in session and not merely a configured server. A
 * server that is known but not signed in to is a row on the Settings page, and
 * every read through the HTTP implementation would fail on a missing token —
 * whereas local-only mode works, which makes it the honest answer while
 * somebody is halfway through joining a community.
 */
export function serverBacked(): ServerBackedApi {
  const { activeUrl, session } = getServerState()
  return activeUrl && session ? httpApi : localApi
}

/** Whether reads are currently coming from a server rather than from this PC. */
export function isServerMode(): boolean {
  const { activeUrl, session } = getServerState()
  return activeUrl !== null && session !== null
}
