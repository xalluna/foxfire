import { protocol } from 'electron'
import { YOUTUBE_HOST_SCHEME } from '@shared/youtubeHost'
import hostHtml from './host/host.html?raw'
import hostScript from './host/host.js?raw'

/**
 * Serves the page YouTube's player lives in — see shared/youtubeHost.ts for
 * why it is a page of its own.
 *
 * Two files and nothing else, from memory: there is no path for anybody to
 * name, and no file on disk behind the scheme. The page's policy lets in
 * YouTube's API script and the privacy-enhanced player's frame, and not so
 * much as an image besides; the recording window that frames it has a policy
 * of its own that lets in this scheme and nothing from YouTube at all.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  // The scheme by name as well as 'self': how 'self' matches an origin on a
  // custom scheme is Chromium's to decide, and this page is nothing without
  // its one script.
  "script-src 'self' foxfire-youtube: https://www.youtube.com https://s.ytimg.com",
  'frame-src https://www.youtube-nocookie.com',
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
}

/** Registered after the app is ready, like the recording scheme. */
export function registerYouTubeHostProtocol(): void {
  protocol.handle(YOUTUBE_HOST_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host !== 'player') return new Response('Not found', { status: 404 })

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(hostHtml, {
        headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    if (url.pathname === '/host.js') {
      return new Response(hostScript, {
        headers: { ...HEADERS, 'Content-Type': 'text/javascript; charset=utf-8' }
      })
    }

    return new Response('Not found', { status: 404 })
  })
}
