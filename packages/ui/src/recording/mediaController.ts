import { FoxfirePlayer, type FoxfirePlayerEvent, type FoxfirePlayerState } from './foxfirePlayer'
import { playbackState, type PlaybackController, type PlaybackState } from './playback'

/**
 * Frames Foxfire Media's player and drives it through its control API, as a
 * {@link PlaybackController}.
 *
 * Shared by both clients, which differ only in what they frame. A browser
 * frames the embed itself, and talks to Foxfire Media's origin. The desktop
 * frames the server's relay page, which frames the embed and passes Foxfire
 * Media's own messages through unchanged, so the desktop talks the very same
 * protocol to the relay's origin.
 *
 * `frameUrl` is a credential for loading one video: it is never logged.
 */
export function mountFoxfirePlayer(
  container: HTMLElement,
  frameUrl: string,
  origin: string,
  label = 'Recording'
): PlaybackController {
  const iframe = document.createElement('iframe')
  iframe.title = label
  iframe.src = frameUrl
  iframe.allow = 'autoplay; fullscreen; picture-in-picture'
  iframe.allowFullscreen = true
  iframe.referrerPolicy = 'no-referrer'
  iframe.className = 'absolute inset-0 h-full w-full border-0'
  container.appendChild(iframe)

  const store = playbackState()
  const player = new FoxfirePlayer(iframe, { origin })

  const take = (state: FoxfirePlayerState, patch: Partial<PlaybackState> = {}): void =>
    store.set({
      ready: state.readyState >= 1 && state.duration > 0,
      playing: !state.paused && !state.ended,
      currentTime: state.currentTime,
      duration: state.duration,
      volume: state.volume,
      muted: state.muted,
      rate: state.playbackRate,
      buffered: state.buffered,
      ...patch
    })

  const reported: FoxfirePlayerEvent[] = [
    'connected',
    'ready',
    'play',
    'pause',
    'timeupdate',
    'seeked',
    'progress',
    'durationchange',
    'ended',
    'volumechange',
    'ratechange'
  ]
  const unsubscribes = reported.map((event) => player.on(event, (state) => take(state)))
  unsubscribes.push(
    player.on('error', (state) =>
      take(state, { error: 'The server could not play this recording. It may have been removed, or the link has lapsed.' })
    )
  )

  // A command the player refuses is reported back as its state anyway, and a
  // timed-out one is worth nothing more than the next event — so none of them
  // is allowed to surface as an unhandled rejection.
  const quietly = (run: () => Promise<FoxfirePlayerState>): void => {
    run().then(
      (state) => take(state),
      () => undefined
    )
  }

  return {
    play: () => quietly(() => player.play()),
    pause: () => quietly(() => player.pause()),
    seek: (seconds) => {
      store.set({ currentTime: Math.max(0, seconds) })
      quietly(() => player.seek(Math.max(0, seconds)))
    },
    setVolume: (volume) => quietly(() => player.setVolume(Math.min(1, Math.max(0, volume)))),
    setMuted: (muted) => quietly(() => player.setMuted(muted)),
    setRate: (rate) => quietly(() => player.setPlaybackRate(Math.min(4, Math.max(0.25, rate)))),
    subscribe: store.subscribe,
    destroy: () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
      player.destroy()
      iframe.remove()
    }
  }
}
