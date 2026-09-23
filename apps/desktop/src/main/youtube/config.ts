/**
 * Foxfire's Google client, as this build was made with it.
 *
 * A "Desktop app" OAuth client, whose secret Google documents as not being a
 * secret: it ships inside every installer, and what protects a sign-in is the
 * PKCE verifier this process makes, not this. It is still kept out of the
 * repository — the release workflow supplies both values at build time from
 * the repository's secrets — so that a fork builds without borrowing Foxfire's
 * Google project and its quota. See docs/YOUTUBE_SETUP.md.
 */
export interface GoogleClient {
  clientId: string
  clientSecret: string
}

export function youtubeClient(): GoogleClient | null {
  const clientId = import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_ID?.trim()
  const clientSecret = import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}
