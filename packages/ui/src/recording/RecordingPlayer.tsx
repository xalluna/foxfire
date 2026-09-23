import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { RecordingEvent } from '@foxfire/core'
import * as Icon from '../components/icons'
import { formatClock } from '../lib/matchStats'
import { EventTimeline } from './EventTimeline'
import { INITIAL_PLAYBACK, type PlaybackController, type PlaybackState, type PlayerSource } from './playback'
import { adjacentEvent, seekTargetFor } from './timelineMarkers'

/**
 * A recording, from wherever it is: the file on this machine, or its copy on YouTube.
 *
 * The two look deliberately different. A file is Foxfire's own player, with
 * its own controls, slow motion and thumbnails on the seek bar. A YouTube copy
 * keeps YouTube's controls — quality, captions and fullscreen are YouTube's to
 * offer, and nothing may be drawn over its frame — with the marker strip and
 * the event buttons underneath, which is what makes it a recording rather than
 * a video.
 */
export function RecordingPlayer({
  source,
  events
}: {
  source: PlayerSource
  events: readonly RecordingEvent[]
}): JSX.Element {
  return source.kind === 'file' ? (
    <FilePlayer src={source.src} events={events} />
  ) : (
    <YouTubePlayer videoId={source.videoId} mount={source.mount} events={events} />
  )
}

/**
 * The file on this machine, and its controls.
 *
 * Hand-built rather than `<video controls>`: the native bar is a Chromium
 * widget that looks nothing like the rest of the app, and there is no way to
 * put event-hopping or the marker track into it.
 *
 * Slow motion is not decoration. Reviewing a lost teamfight at quarter speed is
 * the thing people actually do with this footage, and `playbackRate` makes it
 * nearly free.
 */
const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const

/** Arrow-key jump. Long enough to cover ground, short enough to stay oriented. */
const NUDGE_SECONDS = 5

function FilePlayer({
  src,
  events
}: {
  src: string
  events: readonly RecordingEvent[]
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(seconds, video.duration || seconds))
  }, [])

  /**
   * In and out, rather than only in.
   *
   * The button used to call requestFullscreen unconditionally, so once
   * fullscreen it did nothing and Escape was the only way back.
   */
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen?.()
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }, [])

  /** Hops to the event either side of the playhead — the reason the markers exist. */
  const jumpEvent = useCallback(
    (direction: -1 | 1) => {
      const target = adjacentEvent(events, currentTime, direction)
      if (target) seek(seekTargetFor(target.videoTime))
    },
    [currentTime, events, seek]
  )

  // Tracked from the event rather than from our own clicks, so the icon is
  // still right when the user leaves fullscreen with Escape or F11.
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = speed
  }, [speed])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [volume, muted])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      // Never steal a key from a form control; the header has a button and the
      // Recordings view has inputs.
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return

      switch (event.key) {
        case ' ':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          seek(currentTime - NUDGE_SECONDS)
          break
        case 'ArrowRight':
          seek(currentTime + NUDGE_SECONDS)
          break
        case ',':
          jumpEvent(-1)
          break
        case '.':
          jumpEvent(1)
          break
        case 'f':
          toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentTime, jumpEvent, seek, togglePlay, toggleFullscreen])

  if (failed) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div>
          <p className="font-display text-lg text-text">This recording will not play</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-text-dim">
            The file may have been moved or deleted, or OBS wrote it in a container this app
            cannot read. Recording format must be MP4.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
        <video
          ref={videoRef}
          src={src}
          // h-full w-full to fill the space, object-contain to letterbox rather
          // than crop. max-h/max-w only capped the size, so a recording smaller
          // than the window — which fullscreen always is — sat at its intrinsic
          // resolution in the middle of a black field instead of scaling up.
          // Cropping is not an option: the minimap and the HUD live in the
          // corners, and they are half of what a recording is read for.
          className="h-full w-full object-contain"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
          onClick={togglePlay}
        />
      </div>

      <EventTimeline
        preview={src}
        events={events}
        duration={duration}
        currentTime={currentTime}
        onSeek={seek}
      />

      <div className="flex items-center gap-2 border-t border-hairline px-4 py-2">
        <ControlButton label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
          {playing ? <Icon.Pause /> : <Icon.Play />}
        </ControlButton>
        <ControlButton label="Previous event (,)" onClick={() => jumpEvent(-1)}>
          <Icon.SkipBack />
        </ControlButton>
        <ControlButton label="Next event (.)" onClick={() => jumpEvent(1)}>
          <Icon.SkipForward />
        </ControlButton>

        <span className="ml-1 text-sm tabular-nums text-text-dim">
          {formatClock(Math.round(currentTime))}
          <span className="text-text-mute"> / {formatClock(Math.round(duration))}</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          <ControlButton label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)}>
            {muted || volume === 0 ? <Icon.VolumeOff /> : <Icon.Volume />}
          </ControlButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(event) => {
              setVolume(Number(event.target.value))
              setMuted(false)
            }}
            className="h-1 w-20 accent-accent"
          />

          <select
            value={speed}
            aria-label="Playback speed"
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="h-7 rounded-md border border-hairline bg-canvas px-2 text-2xs tabular-nums text-text focus:border-accent-dim focus:outline-none"
          >
            {SPEEDS.map((option) => (
              <option key={option} value={option}>
                {option}x
              </option>
            ))}
          </select>

          <ControlButton
            label={fullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Icon.Minimize /> : <Icon.Maximize />}
          </ControlButton>
        </div>
      </div>
    </div>
  )
}

/**
 * A copy on YouTube, in YouTube's own player, with Foxfire's markers beneath it.
 *
 * The frame is YouTube's from edge to edge: at least 200 pixels each way,
 * which is YouTube's floor, and nothing layered on top of it. Everything
 * Foxfire adds sits below — the marker strip, the event buttons, the time —
 * and drives the frame through the controller the platform mounted.
 */
function YouTubePlayer({
  videoId,
  mount,
  events
}: {
  videoId: string
  mount: (container: HTMLElement, videoId: string) => PlaybackController
  events: readonly RecordingEvent[]
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PlaybackController | null>(null)
  const [state, setState] = useState<PlaybackState>(INITIAL_PLAYBACK)

  useEffect(() => {
    const container = frameRef.current
    if (!container) return

    const controller = mount(container, videoId)
    controllerRef.current = controller
    const unsubscribe = controller.subscribe(setState)

    return () => {
      unsubscribe()
      controller.destroy()
      controllerRef.current = null
      setState(INITIAL_PLAYBACK)
    }
  }, [mount, videoId])

  const { currentTime, duration, playing } = state

  const seek = useCallback(
    (seconds: number) => {
      const bounded = duration > 0 ? Math.min(seconds, duration) : seconds
      controllerRef.current?.seek(Math.max(0, bounded))
    },
    [duration]
  )

  const jumpEvent = useCallback(
    (direction: -1 | 1) => {
      const target = adjacentEvent(events, currentTime, direction)
      if (target) seek(seekTargetFor(target.videoTime))
    },
    [currentTime, events, seek]
  )

  // Only while focus is on the page. Once somebody clicks into YouTube's
  // frame, its own keys take over and these never arrive — which is right:
  // two players answering one key press would each undo the other.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return

      switch (event.key) {
        case ' ':
          event.preventDefault()
          if (playing) controllerRef.current?.pause()
          else controllerRef.current?.play()
          break
        case 'ArrowLeft':
          seek(currentTime - NUDGE_SECONDS)
          break
        case 'ArrowRight':
          seek(currentTime + NUDGE_SECONDS)
          break
        case ',':
          jumpEvent(-1)
          break
        case '.':
          jumpEvent(1)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentTime, jumpEvent, playing, seek])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="relative min-h-[200px] min-w-[200px] flex-1 bg-black">
        {/* Absolutely filling the area rather than sized by percentage, which a
            flex item's height does not resolve. Kept mounted even when the
            video fails, so the frame the controller owns is torn down by the
            controller rather than by React. */}
        <div ref={frameRef} className={clsx('absolute inset-0', state.error && 'hidden')} />
        {state.error && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
            <div>
              <p className="font-display text-lg text-text">This recording will not play</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-text-dim">{state.error}</p>
            </div>
          </div>
        )}
      </div>

      <EventTimeline events={events} duration={duration} currentTime={currentTime} onSeek={seek} />

      <div className="flex items-center gap-2 border-t border-hairline px-4 py-2">
        <ControlButton label="Previous event (,)" onClick={() => jumpEvent(-1)}>
          <Icon.SkipBack />
        </ControlButton>
        <ControlButton label="Next event (.)" onClick={() => jumpEvent(1)}>
          <Icon.SkipForward />
        </ControlButton>

        <span className="ml-1 text-sm tabular-nums text-text-dim">
          {formatClock(Math.round(currentTime))}
          <span className="text-text-mute"> / {formatClock(Math.round(duration))}</span>
        </span>

        <span className="ml-auto text-2xs text-text-mute">
          {events.length === 0
            ? 'Playing from YouTube · no markers came with this recording'
            : 'Playing from YouTube'}
        </span>
      </div>
    </div>
  )
}

function ControlButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded-md border border-hairline',
        'text-text-dim transition hover:border-accent-dim hover:text-accent'
      )}
    >
      {children}
    </button>
  )
}
