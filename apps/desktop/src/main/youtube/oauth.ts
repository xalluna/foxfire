import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { createLogger } from '../telemetry/logger'
import { youtubeClient } from './config'
import {
  buildAuthUrl,
  createPkce,
  createState,
  emailFromIdToken,
  grantsUpload,
  parseCallback,
  REVOKE_ENDPOINT,
  TOKEN_ENDPOINT
} from './oauthFlow'
import { setConnectedEmail } from './settings'
import { setConnecting, setYouTubeError } from './state'
import { forgetConnection, loadRefreshToken, rememberAccessToken, storeRefreshToken } from './tokens'

const log = createLogger('youtube')

/** Long enough to find the right Google account and read the consent page; short enough not to leave a port open all evening. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

/** What the browser tab shows once Google has handed the code back. */
function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="background:#010A13;color:#C8C0A8;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:28rem"><h1 style="font-weight:500;font-size:20px">${title}</h1><p>${body}</p></div>`
}

let pending: { server: Server; timer: NodeJS.Timeout; cancel: (reason: Error) => void } | null = null

/**
 * Stops a sign-in that is still waiting, and closes its port.
 *
 * Safe to call when there is none, which is how a second Connect cancels the
 * first rather than leaving two servers listening.
 */
export function cancelConnect(): void {
  pending?.cancel(new Error('The sign-in was cancelled.'))
}

/**
 * Connects this machine to a Google account's YouTube channel.
 *
 * Opens Google's consent page in the system browser and waits for it to send
 * the code back to a one-request server on 127.0.0.1 — see oauthFlow.ts for
 * why that way round. Resolves once the refresh token is stored; rejects with
 * something a person can read.
 */
export async function connectYouTube(): Promise<void> {
  const client = youtubeClient()
  if (!client) throw new Error('This build of Foxfire was made without YouTube uploads.')

  cancelConnect()

  const pkce = createPkce()
  const state = createState()
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Loopback only, on whatever port is free: Google allows any port for a
    // desktop client's 127.0.0.1 redirect, and nothing off this machine can
    // reach an address bound here.
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const port = (server.address() as AddressInfo).port
  const redirectUri = `http://127.0.0.1:${port}/`

  setYouTubeError(null)
  setConnecting(true)

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Google did not answer in time, so nothing was connected.')),
        SIGN_IN_TIMEOUT_MS
      )

      pending = { server, timer, cancel: reject }

      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', redirectUri)
        if (url.pathname !== '/') {
          response.writeHead(404).end()
          return
        }

        const result = parseCallback(url, state)
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          result.ok
            ? page('Connected', 'You can close this tab and go back to Foxfire.')
            : page('Not connected', result.message)
        )

        if (result.ok) resolve(result.code)
        else reject(new Error(result.message))
      })

      void shell.openExternal(
        buildAuthUrl({ clientId: client.clientId, redirectUri, state, challenge: pkce.challenge })
      )
    })

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: pkce.verifier
      })
    })

    const tokens = (await response.json().catch(() => ({}))) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      id_token?: string
      scope?: string
      error_description?: string
    }

    if (!response.ok || !tokens.access_token || !tokens.refresh_token) {
      throw new Error(tokens.error_description ?? 'Google would not complete the sign-in.')
    }

    if (!grantsUpload(tokens.scope)) {
      throw new Error(
        'Google was not given permission to upload videos. Connect again and leave that box ticked.'
      )
    }

    storeRefreshToken(tokens.refresh_token)
    rememberAccessToken(tokens.access_token, tokens.expires_in ?? 3600)
    setConnectedEmail(emailFromIdToken(tokens.id_token))
    log.info('Connected to YouTube')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setYouTubeError(message)
    throw err
  } finally {
    if (pending) clearTimeout(pending.timer)
    pending = null
    server.close()
    setConnecting(false)
  }
}

/**
 * Disconnects, and tells Google to forget the grant.
 *
 * Revoked rather than only forgotten here, so the connection is gone from the
 * Google account's own list of apps too. A revoke that fails — offline, say —
 * still disconnects this machine; the grant then lapses on Google's side the
 * next time anything tries to use it.
 */
export async function disconnectYouTube(): Promise<void> {
  const refresh = loadRefreshToken()
  forgetConnection()
  setConnectedEmail(null)
  setYouTubeError(null)

  if (!refresh) return
  try {
    await fetch(`${REVOKE_ENDPOINT}?${new URLSearchParams({ token: refresh })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  } catch (err) {
    log.debug('Could not revoke the YouTube grant', { error: String(err) })
  }
}
