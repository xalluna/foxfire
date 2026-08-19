import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import * as Icon from '../components/icons'
import { formatClock } from '../lib/matchStats'
import { clusterEvents, describeCluster, leadEvent, seekTargetFor } from './timelineMarkers'
import type { ReplayEvent } from '@shared/types'

/**
 * The seek bar, marked with everything that happened to you.
 *
 * This is what the whole feature is for. Scrubbing a thirty-minute recording by
 * hand to find the fight you died in is exactly the job nobody does, so the
 * events are drawn onto the bar and the playhead can hop between them.
 *
 * Only the player's own events are here — their kills, deaths, assists and
 * multikills. A bar carrying every turret and dragon in the game is a smear,
 * and "what happened to me at fourteen minutes" is the question a replay is
 * opened to answer.
 */

const ROLE_STYLE: Record<ReplayEvent['role'], string> = {
  kill: 'text-teal',
  death: 'text-red',
  assist: 'text-text-dim',
  multikill: 'text-accent'
}

function RoleGlyph({ role }: { role: ReplayEvent['role'] }): JSX.Element {
  if (role === 'death') return <Icon.Skull width={11} height={11} />
  if (role === 'multikill') return <Icon.Star filled width={11} height={11} />
  return <Icon.Swords width={11} height={11} />
}

export function EventTimeline({
  src,
  events,
  duration,
  currentTime,
  onSeek
}: {
  /** Same source as the player, for the hover preview's own decoder. */
  src: string
  events: readonly ReplayEvent[]
  duration: number
  currentTime: number
  onSeek: (seconds: number) => void
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const clusters = useMemo(
    () => clusterEvents(events, duration, width),
    [events, duration, width]
  )

  const timeAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || duration <= 0) return 0
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * duration
    },
    [duration]
  )

  /**
   * Paints the hovered frame.
   *
   * A second <video> element rather than seeking the one being watched: moving
   * the playhead to draw a thumbnail would fight whatever the user is doing
   * with it. Drawn on 'seeked' so the canvas keeps the previous frame until the
   * next one has actually decoded, instead of flashing black.
   */
  useEffect(() => {
    const video = previewRef.current
    if (!video) return

    const draw = (): void => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context || video.videoWidth === 0) return
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
    }

    video.addEventListener('seeked', draw)
    return () => video.removeEventListener('seeked', draw)
  }, [])

  useEffect(() => {
    const video = previewRef.current
    if (!video || !hover) return
    // Seeking a large MP4 repeatedly stutters, so the request is coalesced —
    // only the last position the pointer rested on is actually decoded.
    const id = window.setTimeout(() => {
      video.currentTime = hover.time
    }, 60)
    return () => window.clearTimeout(id)
  }, [hover])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="relative select-none px-4 pb-3 pt-6">
      {hover && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md border border-hairline bg-canvas p-1 shadow-flyout"
          style={{ left: hover.x }}
        >
          <canvas ref={canvasRef} width={192} height={108} className="rounded bg-surface-2" />
          <p className="mt-1 text-center text-2xs tabular-nums text-text-dim">
            {formatClock(Math.round(hover.time))}
          </p>
        </div>
      )}

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatClock(Math.round(currentTime))}
        className="relative h-2 cursor-pointer rounded-full bg-surface-2"
        onMouseMove={(event) =>
          setHover({
            x: event.clientX - (trackRef.current?.getBoundingClientRect().left ?? 0) + 16,
            time: timeAt(event.clientX)
          })
        }
        onMouseLeave={() => setHover(null)}
        onClick={(event) => onSeek(timeAt(event.clientX))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5))
          if (event.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 5))
        }}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-accent/70"
          style={{ width: `${progress}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-accent"
          style={{ left: `${progress}%` }}
        />

        {duration > 0 &&
          clusters.map((item) => {
            const lead = leadEvent(item.events)
            return (
              <button
                key={item.videoTime}
                type="button"
                title={describeCluster(item.events)}
                onClick={(event) => {
                  event.stopPropagation()
                  onSeek(seekTargetFor(item.videoTime))
                }}
                className={clsx(
                  'absolute bottom-full mb-1 -translate-x-1/2 rounded p-px transition hover:scale-125',
                  ROLE_STYLE[lead.role]
                )}
                style={{ left: `${(item.videoTime / duration) * 100}%` }}
              >
                <RoleGlyph role={lead.role} />
                {item.events.length > 1 && (
                  <span className="absolute -right-1 -top-1 text-[8px] font-medium tabular-nums text-text">
                    {item.events.length}
                  </span>
                )}
              </button>
            )
          })}
      </div>

      {/* Off-screen and muted: it exists only to decode single frames. */}
      <video ref={previewRef} src={src} muted preload="metadata" className="hidden" />
    </div>
  )
}
