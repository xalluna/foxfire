import { request } from 'node:https'
import { loopbackAgent } from '../loopbackAgent'
import type { LcuCredentials } from './discovery'

export class LcuError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'LcuError'
  }
}

/** GETs a JSON endpoint from the running client. Never touches the Riot rate limiter — this is local traffic. */
export function lcuGet<T>(creds: LcuCredentials, path: string, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path,
        method: 'GET',
        agent: loopbackAgent,
        headers: {
          // The client's fixed basic-auth username; the password is the
          // per-session remoting token.
          Authorization: `Basic ${Buffer.from(`riot:${creds.token}`).toString('base64')}`,
          Accept: 'application/json'
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          const body = Buffer.concat(chunks).toString('utf8')

          if (status < 200 || status >= 300) {
            reject(new LcuError(`LCU ${path} responded ${status}`, status))
            return
          }

          try {
            resolve(JSON.parse(body) as T)
          } catch {
            reject(new LcuError(`LCU ${path} returned malformed JSON`, status))
          }
        })
      }
    )

    req.on('timeout', () => req.destroy(new LcuError(`LCU ${path} timed out`, 0)))
    req.on('error', (err) => reject(err))
    req.end()
  })
}

/**
 * POSTs a JSON body to the running client, for the one thing Foxfire asks it to
 * *do* rather than report: play a replay.
 *
 * Resolves with nothing. These routes answer 204 with an empty body, and there
 * is no useful payload to invent — whether the replay actually opened is
 * something the client shows on its own screen, not something it tells us.
 */
export function lcuPost(
  creds: LcuCredentials,
  path: string,
  body: unknown,
  timeoutMs = 8000
): Promise<void> {
  const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8')

  return new Promise<void>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path,
        method: 'POST',
        agent: loopbackAgent,
        headers: {
          Authorization: `Basic ${Buffer.from(`riot:${creds.token}`).toString('base64')}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': payload.length
        },
        timeout: timeoutMs
      },
      (res) => {
        // The body is drained rather than read: an error body would only be
        // repeating the status, and leaving it unread keeps the socket open.
        res.resume()
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) resolve()
        else reject(new LcuError(`LCU ${path} responded ${status}`, status))
      }
    )

    req.on('timeout', () => req.destroy(new LcuError(`LCU ${path} timed out`, 0)))
    req.on('error', (err) => reject(err))
    req.end(payload)
  })
}
