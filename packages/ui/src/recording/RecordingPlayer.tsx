import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { RecordingEvent } from '@foxfire/core'
import * as Icon from '../components/icons'
import { formatClock } from '../lib/matchStats'
import { EventTimeline } from './EventTimeline'
import {
  INITIAL_PLAYBACK,
  videoController,
  type MediaMount,
  type PlaybackController,
  type PlaybackState,
  type PlayerSource
} from './playback'
import { adjacentEvent, seekTargetFor } from './timelineMarkers'

/**
 * A recording, from wherever it is: the file on this machine, or its copy on
 * the server.
 *
 * One player and one set of controls for both. Hand-built rather than
 * `<video controls>` or Foxfire Media's own bar: neither looks like the rest of
 * the app, and there is no way to put event-hopping or the marker track into
 * either. The server's copy plays in Foxfire Media's frame with its controls
 * hidden, driven through its control API; everything you see is Foxfire's.
 *
 * Slow motion is not decoration. Reviewing a lost teamfight at quarter speed is
 * the thing people actually do with this footage.
 */
export function RecordingPlayer({
  source,
  events
}: {
  source: PlayerSource
  events: readonly RecordingEvent[]
}): JSX.Element {
  const [controller, setController] = useState<PlaybackController | null>(null)
  const [state, setState] = useState<PlaybackState>(INITIAL_PLAYBACK)

  useEffect(() => {
    if (!controller) return
    const unsubscribe = controller.subscribe(setState)
    return () => {
      unsubscribe()
      setState(INITIAL_PLAYBACK)
    }
  }, [controller])

  return (
    <Chrome controller={controller} state={state} events={events} preview={source.kind === 'file' ? source.src : undefined}>
      {source.kind === 'file' ? (
        <FileSurface src={source.src} onController={setController} />
      ) : (
        <MediaSurface embed={source.embed} mount={source.mount} onController={setController} />
      )}
    </Chrome>
  )
}

/** The file on this machine, as a `<video>`. */
function FileSurface({
  src,
  onController
}: {
  src: string
  onController: (controller: PlaybackController | null) => void
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const controller = videoController(video)
    onController(controller)
    return () => {
      controller.destroy()
      onController(null)
    }
  }, [src, onController])

  return (
    <video
      ref={videoRef}
      src={src}
      // h-full w-full to fill the space, object-contain to letterbox rather
      // than crop. Cropping is not an option: the minimap and the HUD live in
      // the corners, and they are half of what a recording is read for.
      className="absolute inset-0 h-full w-full object-contain"
    />
  )
}

/**
 * The server's copy, in Foxfire Media's frame.
 *
 * An embed is asked for each time this opens, because it is good only for
 * loading. The frame is mounted into a div React leaves alone, so the frame the
 * controller owns is torn down by the controller rather than by React.
 */
function MediaSurface({
  embed,
  mount,
  onController
}: {
  embed: () => Promise<{ embedUrl: string }>
  mount: MediaMount
  onController: (controller: PlaybackController | null) => void
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const container = frameRef.current
    if (!container) return
    let controller: PlaybackController | null = null
    let cancelled = false
    setFailure(null)

    embed().then(
      ({ embedUrl }) => {
        if (cancelled) return
        try {
          controller = mount(container, embedUrl)
          onController(controller)
        } catch (err) {
          setFailure(err instanceof Error ? err.message : String(err))
        }
      },
      (err: unknown) => {
        if (!cancelled) setFailure(err instanceof Error ? err.message : String(err))
      }
    )

    return () => {
      cancelled = true
      controller?.destroy()
      onController(null)
    }
  }, [embed, mount, onController])

  return (
    <>
      <div ref={frameRef} className={clsx('absolute inset-0', failure && 'hidden')} />
      {failure && <PlaybackError message={failure} />}
    </>
  )
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const

/** Arrow-key jump. Long enough to cover ground, short enough to stay oriented. */
const NUDGE_SECONDS = 5

/** Foxfire's controls, around whichever surface is playing. */
function Chrome({
  controller,
  state,
  events,
  preview,
  children
}: {
  controller: PlaybackController | null
  state: PlaybackState
  events: readonly RecordingEvent[]
  /** The file to draw seek-bar thumbnails from; a server copy has none to read. */
  preview: string | undefined
  children: JSX.Element
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const { currentTime, duration, playing, volume, muted, rate } = state

  const seek = useCallback(
    (seconds: number) => {
      const bounded = duration > 0 ? Math.min(seconds, duration) : seconds
      controller?.seek(Math.max(0, bounded))
    },
    [controller, duration]
  )

  const togglePlay = useCallback(() => {
    if (playing) controller?.pause()
    else controller?.play()
  }, [controller, playing])

  /** In and out, rather than only in: Escape should not be the only way back. */
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen?.()
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

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="relative min-h-[200px] flex-1 bg-black">
        {children}
        {state.error ? (
          <PlaybackError message={state.error} />
        ) : (
          // Over the video, catching the click that plays and pauses it. Over a
          // server copy it is also what keeps focus on this page, so the keys
          // above keep working rather than vanishing into the frame.
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
            className="absolute inset-0 cursor-pointer bg-transparent"
          />
        )}
      </div>

      <EventTimeline
        preview={preview}
        events={events}
        duration={duration}
        currentTime={currentTime}
        buffered={state.buffered}
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

        {preview === undefined && events.length === 0 && (
          <span className="text-2xs text-text-mute">No markers came with this recording</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ControlButton label={muted ? 'Unmute' : 'Mute'} onClick={() => controller?.setMuted(!muted)}>
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
              controller?.setVolume(Number(event.target.value))
              if (muted) controller?.setMuted(false)
            }}
            className="h-1 w-20 accent-accent"
          />

          <select
            value={rate}
            aria-label="Playback speed"
            onChange={(event) => controller?.setRate(Number(event.target.value))}
            className="h-7 rounded-md border border-edge bg-canvas px-2 text-xs tabular-nums text-text focus:border-accent focus:outline-none"
          >
            {(SPEEDS as readonly number[]).includes(rate) ? null : <option value={rate}>{rate}x</option>}
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

function PlaybackError({ message }: { message: string }): JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
      <div>
        <p className="font-display text-lg text-text">This recording will not play</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-text-dim">{message}</p>
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
        'flex h-7 w-7 items-center justify-center rounded-md border border-edge',
        'text-text-dim transition hover:border-accent-dim hover:text-accent'
      )}
    >
      {children}
    </button>
  )
}
