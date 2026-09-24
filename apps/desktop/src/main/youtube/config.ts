import { YOUTUBE_ENABLED } from '@shared/features'

/**
 * Foxfire's Google client, as this build was made with it.
 *
 * A "Desktop app" OAuth client. Its id is public by nature — it is in the
 * address of every Google sign-in page — and Google documents installed apps
 * as unable to keep a secret, so nothing here is a security boundary: what
 * protects a sign-in is the PKCE verifier this process makes for it, and the
 * loopback address only this machine can reach.
 *
 * The secret is optional. Google lists it as optional when exchanging a code
 * that came with PKCE, and a build made without one ships nothing that looks
 * like a secret at all; a build made with one sends it. Which one a release
 * uses is decided by whether the repository has the secret set — see
 * docs/YOUTUBE_SETUP.md. Both are kept out of the repository either way, so a
 * fork builds without borrowing Foxfire's Google project and its quota.
 */
export interface GoogleClient {
  clientId: string
  /** Null when this build was made without one, and nothing sends it. */
  clientSecret: string | null
}

export function youtubeClient(): GoogleClient | null {
  if (!YOUTUBE_ENABLED) return null
  const clientId = import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_ID?.trim()
  const clientSecret = import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_SECRET?.trim()
  return clientId ? { clientId, clientSecret: clientSecret || null } : null
}
