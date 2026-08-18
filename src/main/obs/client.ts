// Named rather than default. The package exports the class both ways, but the
// main process is bundled to CJS with this dependency left external, and the
// default import lands on the module namespace object instead of the class —
// which typechecks perfectly and then throws "not a constructor" at runtime.
import { OBSWebSocket } from 'obs-websocket-js'
import { createLogger } from '../telemetry/logger'
import { getCaptureSettings, getObsPassword } from '../services/captureSettings'

/**
 * The connection to a local OBS, over the websocket it has bundled since v28.
 *
 * Shaped like lcu/watcher.ts and for the same reasons: a self-scheduling retry
 * rather than setInterval so a slow attempt cannot overlap the next, and a
 * module-level singleton because there is exactly one OBS on the machine.
 *
 * Nothing here throws at its callers. OBS closing mid-game is ordinary — the
 * user alt-tabbed and quit it — and the recording being lost is already the
 * worst outcome; taking the LCU poll or the app down with it would be worse.
 */
const log = createLogger('obs')

export type ObsConnectionState = 'disconnected' | 'connecting' | 'connected'

/** OBS is usually either running or not, so retrying fast forever is pointless. */
const RETRY_MIN_MS = 5_000
const RETRY_MAX_MS = 60_000

let socket: OBSWebSocket | null = null
let state: ObsConnectionState = 'disconnected'
let lastError: string | null = null
let retryMs = RETRY_MIN_MS
let timer: NodeJS.Timeout | null = null
let running = false

type ConnectionListener = (state: ObsConnectionState, error: string | null) => void
type RecordListener = (event: { active: boolean; state: string; path: string | null }) => void

const connectionListeners = new Set<ConnectionListener>()
const recordListeners = new Set<RecordListener>()

export function onObsConnectionChange(cb: ConnectionListener): () => void {
  connectionListeners.add(cb)
  return () => connectionListeners.delete(cb)
}

/**
 * Fires on every recording state change OBS reports.
 *
 * `path` only arrives on the stop, because OBS names the file itself and does
 * not know the final name until it closes it.
 */
export function onObsRecordState(cb: RecordListener): () => void {
  recordListeners.add(cb)
  return () => recordListeners.delete(cb)
}

export function getObsConnectionState(): ObsConnectionState {
  return state
}

export function getObsLastError(): string | null {
  return lastError
}

export function isObsConnected(): boolean {
  return state === 'connected'
}

function setState(next: ObsConnectionState, error: string | null = null): void {
  if (state === next && lastError === error) return
  state = next
  lastError = error
  log.debug('OBS connection state changed', { state: next, error })
  for (const listener of connectionListeners) listener(next, error)
}

/**
 * Issues a request, or throws if OBS is not there.
 *
 * Deliberately untyped in its second parameter rather than threading
 * obs-websocket's generics through every caller: the library validates the
 * response shape at runtime and the call sites read better for it.
 */
export async function obsCall<T = unknown>(
  request: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!socket || state !== 'connected') throw new Error('OBS is not connected')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (socket as any).call(request, args)) as T
}

/** Same, but yields null instead of throwing — for reads that are allowed to fail. */
export async function obsTry<T = unknown>(
  request: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  try {
    return await obsCall<T>(request, args)
  } catch (err) {
    log.debug('OBS request failed', { request, error: String(err) })
    return null
  }
}

async function attempt(): Promise<void> {
  // Everything is inside the try, including constructing the socket. A failure
  // before the await is still a failure to connect, and leaving it outside made
  // it an unhandled rejection that also skipped schedule() — so one synchronous
  // throw silently ended the retry loop rather than backing off and trying again.
  try {
    await connectOnce()
  } catch (err) {
    setState('disconnected', describeConnectError(err))
    schedule()
  }
}

async function connectOnce(): Promise<void> {
  const settings = getCaptureSettings()
  const url = `ws://${settings.obsHost}:${settings.obsPort}`

  const next = new OBSWebSocket()

  next.on('ConnectionClosed', () => {
    // Only meaningful if this is still the live socket — a stale one closing
    // during a reconnect must not report the new connection as gone.
    if (socket !== next) return
    socket = null
    setState('disconnected', 'OBS closed the connection')
    schedule()
  })

  next.on('RecordStateChanged', (data) => {
    for (const listener of recordListeners) {
      listener({
        active: data.outputActive,
        state: String(data.outputState ?? ''),
        // Present only on the stop; the start reports an empty string.
        path: data.outputPath ? String(data.outputPath) : null
      })
    }
  })

  setState('connecting')
  try {
    // An empty password is passed as undefined: obs-websocket rejects a blank
    // one outright rather than treating it as "authentication is off".
    const password = getObsPassword()
    await next.connect(url, password === '' ? undefined : password, { rpcVersion: 1 })
  } catch (err) {
    try {
      await next.disconnect()
    } catch {
      // Already dead; nothing to clean up.
    }
    throw err
  }

  socket = next
  retryMs = RETRY_MIN_MS
  setState('connected')
}

/**
 * Turns obs-websocket's failures into something a user can act on.
 *
 * The two that actually happen are "OBS is not running" and "the password is
 * wrong", and they need different fixes, so they must not both read as
 * "connection failed".
 */
function describeConnectError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/authentication/i.test(message)) return 'OBS rejected the password.'
  if (/ECONNREFUSED|failed to connect|WebSocket error/i.test(message)) {
    return 'No OBS listening — is it running, with the websocket server enabled?'
  }
  return message
}

function schedule(): void {
  if (!running || timer) return
  timer = setTimeout(() => {
    timer = null
    if (running) void attempt()
  }, retryMs)
  // Backs off toward a minute: OBS not running is a state that lasts hours, and
  // hammering a closed port for all of them buys nothing.
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
}

export function startObsClient(): void {
  if (running) return
  running = true
  retryMs = RETRY_MIN_MS
  void attempt()
}

export function stopObsClient(): void {
  running = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const closing = socket
  socket = null
  setState('disconnected')
  if (closing) void closing.disconnect().catch(() => undefined)
}

/** Drops any backoff and tries immediately — what the settings button does. */
export function reconnectObs(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  running = true
  retryMs = RETRY_MIN_MS
  const closing = socket
  socket = null
  if (closing) void closing.disconnect().catch(() => undefined)
  void attempt()
}
