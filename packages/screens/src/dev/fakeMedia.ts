import { playbackState, type MediaMount, type PlaybackController } from '@foxfire/ui'
import { scenario } from './scenario'

/**
 * A stand-in for Foxfire Media's player, for the harnesses.
 *
 * Neither harness has a Foxfire Media to frame, and a design review should not
 * depend on one being up — so this draws a dark panel with a clock that runs
 * while "playing", and answers every command the control API has the way the
 * real controller does, buffering included. Enough to judge Foxfire's own
 * controls and the marker strip against motion. Nothing here takes clicks:
 * the player lays its own catcher over the frame, as it does over the real one.
 */
export function createFakeMediaMount(durationFor: (embedUrl: string) => number = () => 1_800): MediaMount {
  return (container, embedUrl): PlaybackController => {
    const store = playbackState()
    let timer: number | null = null

    const panel = document.createElement('div')
    panel.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;background:#0b0b0f;color:#8a8f98;font:13px system-ui;user-select:none'
    const label = document.createElement('div')
    const hint = document.createElement('div')
    hint.textContent = 'Foxfire Media player stand-in'
    hint.style.cssText = 'font-size:11px;opacity:.6'
    panel.append(label, hint)
    container.append(panel)

    const clock = (seconds: number): string =>
      `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
    const unsubscribe = store.subscribe((state) => {
      label.textContent = state.error
        ? state.error
        : state.ready
          ? `${state.playing ? '▶' : '❚❚'}  ${clock(state.currentTime)} / ${clock(state.duration)}  ·  ${state.rate}x${state.muted ? '  ·  muted' : ''}`
          : 'Loading…'
    })

    const stop = (): void => {
      if (timer !== null) window.clearInterval(timer)
      timer = null
    }

    const buffer = (): void => {
      const { currentTime, duration } = store.get()
      store.set({ buffered: [[0, Math.min(duration, currentTime + 90)]] })
    }

    // As the real one does: nothing is known until the player has loaded.
    window.setTimeout(() => {
      if (scenario === 'recording-unplayable') {
        store.set({ error: 'The server could not play this recording. It may have been removed, or the link has lapsed.' })
        return
      }
      store.set({ ready: true, duration: durationFor(embedUrl) })
      buffer()
    }, 300)

    return {
      play() {
        if (store.get().error || timer !== null) return
        timer = window.setInterval(() => {
          const { currentTime, duration, rate } = store.get()
          const next = Math.min(duration, currentTime + 0.25 * rate)
          store.set({ currentTime: next, playing: next < duration })
          buffer()
          if (next >= duration) stop()
        }, 250)
        store.set({ playing: true })
      },
      pause() {
        stop()
        store.set({ playing: false })
      },
      seek(seconds) {
        store.set({ currentTime: Math.max(0, Math.min(seconds, store.get().duration)) })
        buffer()
      },
      setVolume(volume) {
        store.set({ volume: Math.min(1, Math.max(0, volume)) })
      },
      setMuted(muted) {
        store.set({ muted })
      },
      setRate(rate) {
        store.set({ rate })
      },
      subscribe: store.subscribe,
      destroy() {
        stop()
        unsubscribe()
        panel.remove()
      }
    }
  }
}
