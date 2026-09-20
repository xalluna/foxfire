import { request } from 'node:https'
import { loopbackAgent } from '../loopbackAgent'

/**
 * The Live Client Data API is served by the running game itself, on a fixed
 * port, with no authentication and no rate limit. It answers only while a game
 * is actually in progress on this machine — before that, and after it ends,
 * nothing is listening at all.
 *
 * node:https rather than fetch: undici will not take an https.Agent, and the
 * self-signed certificate leaves no other way to reach the port.
 */
const PORT = 2999

/** Thrown for a response that arrived and was wrong, never for a port with nothing behind it. */
export class LiveClientError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'LiveClientError'
  }
}

/**
 * Rejects with `null` semantics deliberately absent: a refused connection is
 * the ordinary "no game running" case and is reported as a plain Error for the
 * service to recognise, not as a LiveClientError. See isNotRunning below.
 */
export function liveClientGet<T>(path: string, timeoutMs = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: 'GET',
        agent: loopbackAgent,
        headers: { Accept: 'application/json' },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          const body = Buffer.concat(chunks).toString('utf8')

          if (status < 200 || status >= 300) {
            reject(new LiveClientError(`Live client ${path} responded ${status}`, status))
            return
          }

          try {
            resolve(JSON.parse(body) as T)
          } catch {
            reject(new LiveClientError(`Live client ${path} returned malformed JSON`, status))
          }
        })
      }
    )

    req.on('timeout', () => req.destroy(new LiveClientError(`Live client ${path} timed out`, 0)))
    req.on('error', (err) => reject(err))
    req.end()
  })
}

/**
 * Whether an error means "no game to read yet" rather than "something broke".
 *
 * Three ways the same non-answer arrives, because the port comes up in stages:
 *
 * - Refused, reset or unreachable — nothing is listening at all, which is the
 *   state outside a game and the overwhelmingly common one.
 * - 404 — the process is up and serving but has no game to describe. This is
 *   the whole window from champion select through the loading screen until the
 *   game actually starts, which is minutes long and entirely normal. Reporting
 *   it as a failure put an error on screen every time somebody queued.
 * - A timeout — the port stalls briefly while loading in and out.
 *
 * Anything else is a real fault and is allowed through.
 */
export function isNotRunning(err: unknown): boolean {
  if (err instanceof LiveClientError) return err.status === 404 || err.status === 0
  const code = (err as { code?: string } | null)?.code
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH'
}
