import { youtubeErrorMessage } from '@foxfire/core/youtube'
import { INITIAL_PLAYBACK, type PlaybackState, type YouTubeMount } from '@foxfire/ui'
import { scenario } from './scenario'

/**
 * A stand-in for YouTube's player, for the harnesses.
 *
 * Neither harness may load YouTube — the desktop's renderer CSP forbids the
 * frame, and a design review should not depend on somebody's video still
 * being up — so this draws a dark panel with a clock that runs while
 * "playing", and answers seeks the way the real controller does. Enough to
 * judge the marker strip against motion.
 */
export function createFakeYouTubeMount(durationFor: (videoId: string) => number = () => 1_800): YouTubeMount {
  return (container, videoId) => {
    let state: PlaybackState = INITIAL_PLAYBACK
    const listeners = new Set<(next: PlaybackState) => void>()
    let timer: number | null = null

    const set = (patch: Partial<PlaybackState>): void => {
      state = { ...state, ...patch }
      label.textContent = describe()
      for (const listener of listeners) listener(state)
    }

    const panel = document.createElement('div')
    panel.style.cssText =
      'display:flex;height:100%;width:100%;align-items:center;justify-content:center;flex-direction:column;gap:6px;background:#0b0b0f;color:#8a8f98;font:13px system-ui;cursor:pointer;user-select:none'
    const label = document.createElement('div')
    const hint = document.createElement('div')
    hint.textContent = `YouTube player stand-in · ${videoId} · click to play or pause`
    hint.style.cssText = 'font-size:11px;opacity:.6'
    panel.append(label, hint)
    container.append(panel)

    const clock = (seconds: number): string =>
      `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
    const describe = (): string =>
      state.error ? state.error : `${state.playing ? '▶' : '❚❚'}  ${clock(state.currentTime)} / ${clock(state.duration)}`

    const stop = (): void => {
      if (timer !== null) window.clearInterval(timer)
      timer = null
    }

    const controller = {
      play() {
        if (state.error || timer !== null) return
        timer = window.setInterval(() => {
          const next = Math.min(state.duration, state.currentTime + 0.25)
          set({ currentTime: next, playing: next < state.duration })
          if (next >= state.duration) stop()
        }, 250)
        set({ playing: true })
      },
      pause() {
        stop()
        set({ playing: false })
      },
      seek(seconds: number) {
        set({ currentTime: Math.max(0, Math.min(seconds, state.duration)) })
      },
      subscribe(listener: (next: PlaybackState) => void) {
        listeners.add(listener)
        listener(state)
        return () => listeners.delete(listener)
      },
      destroy() {
        stop()
        listeners.clear()
        panel.remove()
      }
    }

    panel.addEventListener('click', () => (state.playing ? controller.pause() : controller.play()))

    // As the real one does: nothing is known until the player has loaded.
    window.setTimeout(() => {
      if (scenario === 'recording-private') set({ error: youtubeErrorMessage(100) })
      else set({ ready: true, duration: durationFor(videoId) })
    }, 300)

    label.textContent = 'Loading…'
    return controller
  }
}
