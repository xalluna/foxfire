import { clearSecret, hasSecret, loadSecret, saveSecret } from '../security/keyStore'
import { createLogger } from '../telemetry/logger'
import { youtubeClient } from './config'
import { TOKEN_ENDPOINT } from './oauthFlow'

const log = createLogger('youtube')

/**
 * The Google refresh token's name in the secret store, beside the Riot key and
 * the server sessions. Encrypted with the OS's own key; never sent over IPC.
 */
const REFRESH_SECRET = 'youtube-refresh-token'

/** A minute of slack, so a token is never used in the last seconds before it lapses mid-chunk. */
const EXPIRY_MARGIN_MS = 60_000

/** Google could not be asked just now — a blip, not a verdict. The upload backs off and tries again. */
export class YouTubeTokenUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YouTubeTokenUnavailable'
  }
}

/** Google took the connection back: revoked, expired, or the password changed. */
export class YouTubeAuthLost extends Error {
  constructor(message = 'Foxfire is no longer connected to YouTube. Connect again in Settings › YouTube.') {
    super(message)
    this.name = 'YouTubeAuthLost'
  }
}

let access: { token: string; expiresAt: number } | null = null

export function isConnected(): boolean {
  return hasSecret(REFRESH_SECRET)
}

export function storeRefreshToken(token: string): void {
  saveSecret(REFRESH_SECRET, token)
}

export function loadRefreshToken(): string | null {
  return loadSecret(REFRESH_SECRET)
}

export function rememberAccessToken(token: string, expiresInSeconds: number): void {
  access = { token, expiresAt: Date.now() + expiresInSeconds * 1000 }
}

/** Forgets the access token, so the next request refreshes — after a 401 that should not have happened. */
export function forgetAccessToken(): void {
  access = null
}

export function forgetConnection(): void {
  access = null
  clearSecret(REFRESH_SECRET)
}

/**
 * An access token good for at least another minute.
 *
 * An hour is all Google gives one, and an upload of a long game on a slow
 * connection outlasts that, so the uploader asks before every chunk and this
 * refreshes when it has to.
 */
export async function getAccessToken(): Promise<string> {
  if (access && access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return access.token

  const client = youtubeClient()
  const refresh = loadRefreshToken()
  if (!client || !refresh) throw new YouTubeAuthLost()

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token'
    })
  })

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error?: string
  }

  if (!response.ok || !body.access_token) {
    if (body.error === 'invalid_grant') {
      // Revoked from the Google account, or — while the consent screen is in
      // Testing — simply a week old. Either way it will never work again.
      log.info('Google refused the refresh token; forgetting the connection')
      forgetConnection()
      throw new YouTubeAuthLost()
    }
    throw new YouTubeTokenUnavailable(`Google would not refresh the sign-in (${body.error ?? response.status}).`)
  }

  rememberAccessToken(body.access_token, body.expires_in ?? 3600)
  return body.access_token
}
