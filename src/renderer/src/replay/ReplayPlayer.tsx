import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as Icon from '../components/icons'
import { formatClock } from '../lib/matchStats'
import { EventTimeline } from './EventTimeline'
import { adjacentEvent, seekTargetFor } from './timelineMarkers'
import type { ReplayEvent } from '@shared/types'

/**
 * The video and its controls.
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

export function ReplayPlayer({
  src,
  events
}: {
  src: string
  events: readonly ReplayEvent[]
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

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(seconds, video.duration || seconds))
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
      // Replays view has inputs.
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
          void containerRef.current?.requestFullscreen?.()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentTime, jumpEvent, seek, togglePlay])

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
          className="max-h-full max-w-full"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
          onClick={togglePlay}
        />
      </div>

      <EventTimeline
        src={src}
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
            className="h-1 w-20 accent-gold"
          />

          <select
            value={speed}
            aria-label="Playback speed"
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="h-7 rounded-md border border-hairline bg-canvas px-2 text-2xs tabular-nums text-text focus:border-gold-dim focus:outline-none"
          >
            {SPEEDS.map((option) => (
              <option key={option} value={option}>
                {option}x
              </option>
            ))}
          </select>

          <ControlButton
            label="Fullscreen (f)"
            onClick={() => void containerRef.current?.requestFullscreen?.()}
          >
            <Icon.Maximize />
          </ControlButton>
        </div>
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
        'text-text-dim transition hover:border-gold-dim hover:text-gold'
      )}
    >
      {children}
    </button>
  )
}
