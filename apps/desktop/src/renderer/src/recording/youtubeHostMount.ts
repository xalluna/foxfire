import { youtubeErrorMessage } from '@foxfire/core/youtube'
import { INITIAL_PLAYBACK, type PlaybackState, type YouTubeMount } from '@foxfire/ui'
import {
  HOST_MESSAGE_TYPE,
  YOUTUBE_HOST_ORIGIN,
  youtubeHostUrl,
  type HostCommand,
  type HostSnapshot
} from '@shared/youtubeHost'

/**
 * YouTube's player on the desktop: a frame on the host page, driven by message.
 *
 * The browser loads YouTube's API into its own page; this window cannot,
 * because it carries the bridge to the main process — see
 * shared/youtubeHost.ts. So the API runs on the host page, a separate origin
 * with no preload, and this is the recording window's side of the
 * conversation: commands out, the player's state back.
 *
 * Only messages from that frame and that origin are read, so no other page
 * this window ever shows can move the playhead or claim an error.
 */
export const youtubeHostMount: YouTubeMount = (container, videoId) => {
  let state: PlaybackState = INITIAL_PLAYBACK
  const listeners = new Set<(next: PlaybackState) => void>()

  const frame = document.createElement('iframe')
  frame.src = youtubeHostUrl(videoId)
  frame.title = 'Recording on YouTube'
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0'
  container.append(frame)

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow || event.origin !== YOUTUBE_HOST_ORIGIN) return
    const data = event.data as Partial<HostSnapshot> | null
    if (!data || data.type !== HOST_MESSAGE_TYPE) return

    state = {
      ready: data.ready === true,
      playing: data.playing === true,
      currentTime: typeof data.currentTime === 'number' ? data.currentTime : 0,
      duration: typeof data.duration === 'number' ? data.duration : 0,
      error: typeof data.errorCode === 'number' ? youtubeErrorMessage(data.errorCode) : null
    }
    for (const listener of listeners) listener(state)
  }

  window.addEventListener('message', onMessage)

  const send = (command: HostCommand): void => {
    frame.contentWindow?.postMessage(command, YOUTUBE_HOST_ORIGIN)
  }

  return {
    play: () => send({ type: HOST_MESSAGE_TYPE, cmd: 'play' }),
    pause: () => send({ type: HOST_MESSAGE_TYPE, cmd: 'pause' }),
    seek: (seconds) => send({ type: HOST_MESSAGE_TYPE, cmd: 'seek', seconds }),
    subscribe: (listener) => {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    destroy: () => {
      window.removeEventListener('message', onMessage)
      listeners.clear()
      frame.remove()
    }
  }
}
