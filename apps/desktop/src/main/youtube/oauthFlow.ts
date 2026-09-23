import { createHash, randomBytes } from 'node:crypto'

/**
 * The parts of signing in to Google that are only rules: what to ask for, how
 * to prove the answer came back to the same process, and what came back.
 *
 * Google's flow for an installed app. The system browser opens Google's own
 * page — never a window of ours, which a person cannot tell apart from a
 * phishing page and Google refuses to be embedded in anyway — and hands a code
 * back to a server on 127.0.0.1 that this process opened for the one request.
 * PKCE ties that code to this process: something else on the machine that
 * catches the redirect has the code but not the verifier.
 */

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'

/**
 * Upload, and who is uploading.
 *
 * youtube.upload is the narrowest scope that can put a video on a channel: it
 * cannot read the channel, change a video or delete one. openid and email
 * name the Google account, so Settings can say where uploads are going.
 */
export const SCOPES = ['openid', 'email', UPLOAD_SCOPE] as const

export interface Pkce {
  verifier: string
  challenge: string
}

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: challengeFor(verifier) }
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function createState(): string {
  return randomBytes(16).toString('base64url')
}

export function buildAuthUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    state: input.state,
    // A refresh token, so uploads keep working after the hour an access token
    // lasts — and asked for every time, because Google only hands one out on
    // the first consent unless it is.
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${AUTH_ENDPOINT}?${params}`
}

export type CallbackResult =
  | { ok: true; code: string }
  | { ok: false; message: string }

/** What Google sent back to the loopback address, read. */
export function parseCallback(url: URL, expectedState: string): CallbackResult {
  const error = url.searchParams.get('error')
  if (error) {
    return {
      ok: false,
      message:
        error === 'access_denied'
          ? 'Google was not given permission, so nothing was connected.'
          : `Google refused the sign-in (${error}).`
    }
  }

  // Checked before the code is looked at: a redirect that does not carry the
  // state this process made is not the answer to its question.
  if (url.searchParams.get('state') !== expectedState) {
    return { ok: false, message: 'The sign-in came back from somewhere it was not sent, so it was ignored.' }
  }

  const code = url.searchParams.get('code')
  return code ? { ok: true, code } : { ok: false, message: 'Google did not send a sign-in code back.' }
}

/**
 * Whether the upload permission was actually granted.
 *
 * Google lets a person untick scopes on its consent page, and a sign-in that
 * came back without upload is a connection that cannot do the one thing it is
 * for.
 */
export function grantsUpload(scope: string | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes(UPLOAD_SCOPE)
}

/**
 * The Google account's address, from the ID token that came with the tokens.
 *
 * Read without verifying the signature, which is fine for what it is used
 * for: the token came straight from Google's token endpoint over TLS, and the
 * address is only ever shown back to the person who signed in.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown }
    return typeof claims.email === 'string' ? claims.email : null
  } catch {
    return null
  }
}
