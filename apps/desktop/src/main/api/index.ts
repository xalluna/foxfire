import { localApi } from './local'
import type { ServerBackedApi } from './types'

export type { ServerBackedApi } from './types'

/**
 * Whichever implementation is currently answering the renderer's reads.
 *
 * Today there is only one, and this returns it. It exists as a function rather
 * than an exported constant because of when handlers are registered: once, at
 * startup, for the life of the process. A handler that closed over the value
 * would keep answering from whatever was active the moment the app booted, and
 * connecting to a server — or disconnecting from one — has to change what the
 * next call reads, not what the next launch reads.
 *
 * So handlers call this per invoke. It is a property lookup on the far side of
 * an IPC round trip that has already crossed a process boundary.
 */
export function serverBacked(): ServerBackedApi {
  return localApi
}
