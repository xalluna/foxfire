/**
 * Getting from whatever somebody pasted to the eleven characters YouTube means by it.
 *
 * People paste what their browser shows them, and that is rarely the canonical
 * watch URL: a share link from the app, a Shorts address, a Studio link to the
 * embed, a watch URL with a timestamp and a playlist hanging off it. All of
 * them name the same video, and only the id is stored — the server re-derives
 * every URL it needs, so nothing pasted is ever put back into a page as-is.
 *
 * Anything that is not unmistakably YouTube is refused rather than guessed at.
 * An id pulled out of some other site's URL would attach a recording that
 * plays something else entirely.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** Hosts whose `?v=` or path names a video. Lower case, without a leading `www.`. */
const WATCH_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com'])
const EMBED_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'])

/** Path prefixes that are followed directly by the id: `/shorts/<id>`, `/embed/<id>`… */
const PATH_FORMS = ['shorts', 'embed', 'live', 'v', 'e']

export function isYouTubeVideoId(value: string): boolean {
  return VIDEO_ID.test(value)
}

/**
 * The video id in a YouTube link or a bare id, or null when there is not one.
 *
 * Accepts `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`,
 * the `m.` and `music.` hosts and youtube-nocookie.com, with or without a
 * scheme, and ignores everything after the id — `t`, `si`, `list` and the rest.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const text = input.trim()
  if (text === '') return null
  if (isYouTubeVideoId(text)) return text

  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const segments = url.pathname.split('/').filter((segment) => segment !== '')

  const candidate = ((): string | null => {
    if (host === 'youtu.be') return segments[0] ?? null

    if (WATCH_HOSTS.has(host) && segments[0] === 'watch') return url.searchParams.get('v')

    if (EMBED_HOSTS.has(host) || WATCH_HOSTS.has(host)) {
      const [form, id] = segments
      if (form && PATH_FORMS.includes(form)) return id ?? null
    }

    return null
  })()

  return candidate !== null && isYouTubeVideoId(candidate) ? candidate : null
}

/** Where a person opens the video on YouTube itself. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

/**
 * What the embedded player's error codes mean, in words a person can act on.
 *
 * The codes are the IFrame API's own. 153 is the one that is about us rather
 * than the video: YouTube refuses to play for a page it cannot identify, which
 * is what an embed with no Referer looks like.
 */
export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'That is not a YouTube video id.'
    case 5:
      return 'YouTube could not play this video here.'
    case 100:
      return 'This video is private, or it has been removed from YouTube.'
    case 101:
    case 150:
      return 'The owner of this video does not allow it to be played outside YouTube.'
    case 152:
    case 153:
      return 'YouTube would not play this video here because it could not tell where it was being played from.'
    default:
      return `YouTube could not play this video (error ${code}).`
  }
}
