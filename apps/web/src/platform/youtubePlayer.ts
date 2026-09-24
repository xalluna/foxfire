import { youtubeErrorMessage } from '@foxfire/core/youtube'
import { INITIAL_PLAYBACK, type PlaybackState, type YouTubeMount } from '@foxfire/ui'

/**
 * YouTube's player, driven from the page, for the recording page's marker strip.
 *
 * The official IFrame API rather than talking to the frame by hand: it is the
 * supported way to seek a YouTube embed and to ask where it is, and the
 * server's CSP allows exactly its script and the privacy-enhanced player's
 * frame (see SpaHosting).
 *
 * The frame is made here rather than by the API, for its referrer. This page
 * is served with `Referrer-Policy: same-origin`, so a frame the API made would
 * ask YouTube for the video with no Referer at all — and YouTube now refuses
 * to play for an embedder it cannot identify (error 153). The frame carries
 * its own policy instead, sending this server's origin and nothing more.
 */

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  destroy(): void
}

interface YTNamespace {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady?: () => void
        onStateChange?: (event: { data: number }) => void
        onError?: (event: { data: number }) => void
      }
    }
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const IFRAME_API = 'https://www.youtube.com/iframe_api'
const EMBED_ORIGIN = 'https://www.youtube-nocookie.com'

/** YT.PlayerState.PLAYING. */
const PLAYING = 1

/** Four times a second while playing: the API has no time event, and the playhead should not visibly step. */
const POLL_MS = 250

let api: Promise<YTNamespace> | null = null

/** Loads the IFrame API once per page, however many players ask. */
function loadApi(): Promise<YTNamespace> {
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }

    const script = document.createElement('script')
    script.src = IFRAME_API
    script.async = true
    script.onerror = () => {
      // Let the next player try again, rather than every recording on the
      // page failing for the rest of the session over one blocked request.
      api = null
      reject(new Error('YouTube could not be reached.'))
    }
    document.head.append(script)
  })
  return api
}

export function createWebYouTubeMount(): YouTubeMount {
  return (container, videoId) => {
    let state: PlaybackState = INITIAL_PLAYBACK
    const listeners = new Set<(next: PlaybackState) => void>()
    let player: YTPlayer | null = null
    let poll: number | null = null
    let destroyed = false

    const set = (patch: Partial<PlaybackState>): void => {
      if (destroyed) return
      state = { ...state, ...patch }
      for (const listener of listeners) listener(state)
    }

    const readTime = (): void => {
      if (!player) return
      set({ currentTime: player.getCurrentTime(), duration: player.getDuration() || state.duration })
    }

    const stopPolling = (): void => {
      if (poll !== null) window.clearInterval(poll)
      poll = null
    }

    const params = new URLSearchParams({
      enablejsapi: '1',
      origin: window.location.origin,
      playsinline: '1',
      rel: '0'
    })

    const iframe = document.createElement('iframe')
    iframe.src = `${EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params}`
    iframe.title = 'Recording on YouTube'
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'
    iframe.style.cssText = 'display:block;width:100%;height:100%;border:0'
    container.append(iframe)

    loadApi()
      .then((YT) => {
        if (destroyed) return
        player = new YT.Player(iframe, {
          events: {
            onReady: () => set({ ready: true, duration: player?.getDuration() ?? 0 }),
            onStateChange: ({ data }) => {
              const playing = data === PLAYING
              set({ playing })
              readTime()
              stopPolling()
              if (playing) poll = window.setInterval(readTime, POLL_MS)
            },
            onError: ({ data }) => {
              stopPolling()
              set({ playing: false, error: youtubeErrorMessage(data) })
            }
          }
        })
      })
      .catch(() => set({ error: 'YouTube could not be reached, so this recording cannot play here.' }))

    return {
      play: () => player?.playVideo(),
      pause: () => player?.pauseVideo(),
      seek: (seconds) => {
        player?.seekTo(seconds, true)
        // Straight away rather than on the next poll, so the marker strip
        // does not show the playhead where it was for a quarter of a second.
        set({ currentTime: seconds })
      },
      subscribe: (listener) => {
        listeners.add(listener)
        listener(state)
        return () => listeners.delete(listener)
      },
      destroy: () => {
        destroyed = true
        stopPolling()
        listeners.clear()
        try {
          player?.destroy()
        } catch {
          // A player that never finished loading has nothing to tear down.
        }
        iframe.remove()
      }
    }
  }
}
