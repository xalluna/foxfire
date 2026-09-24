import type { RecordingEvent } from '@foxfire/core'

/**
 * Turning a game's worth of events into marks on a seek bar.
 *
 * Split out of EventTimeline because it is the part that can be wrong in ways
 * you cannot see: two kills four seconds apart in a forty-minute game land on
 * the same pixel, and whether they merge, which glyph the merged mark takes and
 * what it says on hover are all decisions with no visual tell when they go
 * wrong. Pure, so they can be tested — the same reason the live-client mapping
 * lives apart from the view that draws it.
 */

/** Markers closer together than this on screen share one glyph. */
export const CLUSTER_PX = 14

export interface MarkerCluster {
  /** Seconds. Where clicking the marker seeks to, and its position on the bar. */
  videoTime: number
  events: RecordingEvent[]
}

/**
 * Which event decides a merged marker's colour and glyph.
 *
 * Ordered by what you would want to find again. A multikill outranks the kills
 * it is made of, and a death outranks a kill: a trade you lost is the thing
 * worth reviewing, and if both happened in the same second the death is the
 * reason you are looking.
 */
const ROLE_PRIORITY: ReadonlyArray<RecordingEvent['role']> = ['multikill', 'death', 'kill', 'assist']

export function leadEvent(events: readonly RecordingEvent[]): RecordingEvent {
  for (const role of ROLE_PRIORITY) {
    const found = events.find((event) => event.role === role)
    if (found) return found
  }
  return events[0]!
}

/**
 * Groups markers that would overlap at the bar's current width.
 *
 * Resolution-dependent by design: the same game clusters differently in a
 * narrow window than a wide one, which is the point — the bar is only ever as
 * precise as its pixels.
 */
export function clusterEvents(
  events: readonly RecordingEvent[],
  duration: number,
  width: number
): MarkerCluster[] {
  // Before the video reports its length there is no scale to cluster against,
  // so every event stands alone rather than collapsing into one pile at zero.
  if (duration <= 0 || width <= 0) {
    return events.map((event) => ({ videoTime: event.videoTime, events: [event] }))
  }

  const pixelsPerSecond = width / duration
  const out: MarkerCluster[] = []

  for (const event of [...events].sort((a, b) => a.videoTime - b.videoTime)) {
    const last = out[out.length - 1]
    if (last && (event.videoTime - last.videoTime) * pixelsPerSecond < CLUSTER_PX) {
      last.events.push(event)
      continue
    }
    out.push({ videoTime: event.videoTime, events: [event] })
  }

  return out
}

/** mm:ss, matching how the rest of the app writes a game clock. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The hover text for a marker. */
export function describeCluster(events: readonly RecordingEvent[]): string {
  const at = clock(events[0]?.videoTime ?? 0)
  if (events.length !== 1) return `${at} — ${events.length} events`

  const [event] = events as [RecordingEvent]
  const who = event.label ?? 'someone'
  switch (event.role) {
    case 'multikill':
      return `${at} — ${event.label ?? ''}x multikill`
    case 'death':
      return `${at} — killed by ${who}`
    case 'kill':
      return `${at} — killed ${who}`
    case 'assist':
      return `${at} — assisted on ${who}`
  }
}

/**
 * How far before an event to drop the playhead.
 *
 * The useful moment is the approach to a fight, not the frame somebody dies in
 * — seeking exactly to a death shows you the aftermath and nothing about why.
 */
export const LEAD_IN_SECONDS = 3

export function seekTargetFor(videoTime: number): number {
  return Math.max(0, videoTime - LEAD_IN_SECONDS)
}

/**
 * The next marker in a direction, for the prev/next buttons and , / . keys.
 *
 * Asymmetric on purpose. Because seeking lands LEAD_IN_SECONDS before an event,
 * the playhead after a jump sits *behind* the marker it jumped to — so "next"
 * only needs to clear the playhead, while "previous" has to clear the marker
 * the playhead is currently parked in front of, or it returns the same one and
 * the button appears dead.
 */
export function adjacentEvent(
  events: readonly RecordingEvent[],
  currentTime: number,
  direction: -1 | 1
): RecordingEvent | null {
  const ordered = [...events].sort((a, b) => a.videoTime - b.videoTime)

  if (direction === 1) {
    return ordered.find((event) => event.videoTime > currentTime + 0.5) ?? null
  }

  return (
    [...ordered]
      .reverse()
      .find((event) => event.videoTime < currentTime - LEAD_IN_SECONDS - 0.5) ?? null
  )
}
