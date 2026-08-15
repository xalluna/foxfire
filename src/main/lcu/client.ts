import { Agent, request } from 'node:https'
import type { LcuCredentials } from './discovery'

/**
 * The League client serves its API over HTTPS on loopback using a self-signed
 * certificate that no trust store will ever accept, so verification has to be
 * off for the connection to succeed at all.
 *
 * Scoped deliberately to this one agent rather than set globally: every other
 * request the app makes — Riot's API, Data Dragon — keeps full verification.
 * The blast radius is one hard-coded loopback host that is not reachable off
 * the machine.
 */
const loopbackAgent = new Agent({ rejectUnauthorized: false, keepAlive: true })

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
