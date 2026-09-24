import { session } from 'electron'
import { YOUTUBE_HOST_SCHEME, YOUTUBE_REFERER } from '@shared/youtubeHost'

/**
 * Tells YouTube who is embedding it.
 *
 * YouTube's player now refuses to play (error 153) for a page that sends no
 * Referer, and the host page sends none: it is on a scheme of our own, and
 * Chromium only ever sends a Referer from http and https pages. YouTube's
 * rules for a desktop app are to send a URL built from the app's identifier
 * instead, which is what this puts on the requests the host page makes.
 *
 * Only on those. A request YouTube's own frame makes carries YouTube's
 * address as its referrer, and is left exactly as it was.
 */
export function installYouTubeReferer(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*', 'https://s.ytimg.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      const existing = Object.keys(headers).find((name) => name.toLowerCase() === 'referer')
      const from = existing ? headers[existing] : details.referrer

      if (!from || from.startsWith(`${YOUTUBE_HOST_SCHEME}:`)) {
        if (existing) delete headers[existing]
        headers['Referer'] = YOUTUBE_REFERER
      }

      callback({ requestHeaders: headers })
    }
  )
}
