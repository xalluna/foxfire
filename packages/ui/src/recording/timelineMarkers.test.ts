import { describe, expect, it } from 'vitest'
import {
  adjacentEvent,
  clusterEvents,
  describeCluster,
  LEAD_IN_SECONDS,
  leadEvent,
  seekTargetFor
} from './timelineMarkers'
import type { RecordingEvent } from '@foxfire/core'

/** A 30-minute game on a 900px bar: one pixel is two seconds. */
const DURATION = 1_800
const WIDTH = 900

function event(over: Partial<RecordingEvent> = {}): RecordingEvent {
  return {
    eventId: 1,
    name: 'ChampionKill',
    gameTime: 240,
    videoTime: 200,
    role: 'kill',
    label: 'Ahri',
    ...over
  }
}

describe('clusterEvents', () => {
  it('leaves events that are far apart alone', () => {
    const clusters = clusterEvents(
      [event({ eventId: 1, videoTime: 100 }), event({ eventId: 2, videoTime: 600 })],
      DURATION,
      WIDTH
    )

    expect(clusters).toHaveLength(2)
  })

  it('merges the kills and multikill of one fight into a single marker', () => {
    // Two kills four seconds apart plus the multikill they add up to — two
    // pixels apart on this bar, so three glyphs would be an unreadable smear.
    const clusters = clusterEvents(
      [
        event({ eventId: 1, videoTime: 862 }),
        event({ eventId: 2, videoTime: 866 }),
        event({ eventId: 3, videoTime: 867, role: 'multikill', label: '2' })
      ],
      DURATION,
      WIDTH
    )

    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.events).toHaveLength(3)
  })

  it('anchors a merged marker to its first event, not its average', () => {
    const clusters = clusterEvents(
      [event({ eventId: 1, videoTime: 862 }), event({ eventId: 2, videoTime: 870 })],
      DURATION,
      WIDTH
    )

    // Seeking to the start of a fight is useful; seeking to its midpoint is not.
    expect(clusters[0]?.videoTime).toBe(862)
  })

  it('separates the same two events on a wider bar', () => {
    const pair = [event({ eventId: 1, videoTime: 500 }), event({ eventId: 2, videoTime: 520 })]

    expect(clusterEvents(pair, DURATION, 400)).toHaveLength(1)
    expect(clusterEvents(pair, DURATION, 4_000)).toHaveLength(2)
  })

  it('sorts before grouping, so an out-of-order list still clusters', () => {
    const clusters = clusterEvents(
      [event({ eventId: 3, videoTime: 900 }), event({ eventId: 1, videoTime: 100 })],
      DURATION,
      WIDTH
    )

    expect(clusters.map((c) => c.videoTime)).toEqual([100, 900])
  })

  it('does not pile everything at zero before the video reports its length', () => {
    // onLoadedMetadata has not fired yet, so there is no scale to cluster
    // against — collapsing them all would draw one marker and then never
    // recover once the duration arrived.
    const clusters = clusterEvents(
      [event({ eventId: 1, videoTime: 100 }), event({ eventId: 2, videoTime: 101 })],
      0,
      WIDTH
    )

    expect(clusters).toHaveLength(2)
  })

  it('handles a game nothing happened in', () => {
    expect(clusterEvents([], DURATION, WIDTH)).toEqual([])
  })
})

describe('leadEvent', () => {
  it('lets the multikill speak for the kills it is made of', () => {
    const events = [
      event({ role: 'kill' }),
      event({ role: 'kill' }),
      event({ role: 'multikill', label: '2' })
    ]

    expect(leadEvent(events).role).toBe('multikill')
  })

  it('shows the death when a trade went both ways', () => {
    // The trade you lost is the one worth reviewing.
    expect(leadEvent([event({ role: 'kill' }), event({ role: 'death' })]).role).toBe('death')
  })

  it('prefers a kill to an assist', () => {
    expect(leadEvent([event({ role: 'assist' }), event({ role: 'kill' })]).role).toBe('kill')
  })
})

describe('describeCluster', () => {
  it('names who you killed', () => {
    expect(describeCluster([event({ videoTime: 200, role: 'kill', label: 'Ahri' })])).toBe(
      '3:20 — killed Ahri'
    )
  })

  it('names who killed you', () => {
    expect(describeCluster([event({ videoTime: 362, role: 'death', label: 'Lee Sin' })])).toBe(
      '6:02 — killed by Lee Sin'
    )
  })

  it('reads an assist as an assist', () => {
    expect(describeCluster([event({ videoTime: 600, role: 'assist', label: 'Aatrox' })])).toBe(
      '10:00 — assisted on Aatrox'
    )
  })

  it('counts a multikill', () => {
    expect(describeCluster([event({ videoTime: 867, role: 'multikill', label: '3' })])).toBe(
      '14:27 — 3x multikill'
    )
  })

  it('survives an event whose other player the game did not name', () => {
    expect(describeCluster([event({ videoTime: 60, role: 'death', label: null })])).toBe(
      '1:00 — killed by someone'
    )
  })

  it('counts a merged marker rather than listing it', () => {
    expect(
      describeCluster([event({ videoTime: 862 }), event({ videoTime: 866 })])
    ).toBe('14:22 — 2 events')
  })
})

describe('seekTargetFor', () => {
  it('lands before the event, because the approach is the part worth watching', () => {
    expect(seekTargetFor(200)).toBe(200 - LEAD_IN_SECONDS)
  })

  it('does not seek before the start of the recording', () => {
    expect(seekTargetFor(1)).toBe(0)
  })
})

describe('adjacentEvent', () => {
  const events = [
    event({ eventId: 1, videoTime: 100 }),
    event({ eventId: 2, videoTime: 400 }),
    event({ eventId: 3, videoTime: 900 })
  ]

  it('finds the next event ahead of the playhead', () => {
    expect(adjacentEvent(events, 150, 1)?.eventId).toBe(2)
  })

  it('finds the previous one behind it', () => {
    expect(adjacentEvent(events, 500, -1)?.eventId).toBe(2)
  })

  it('does not return the event the playhead was just parked in front of', () => {
    // After jumping to event 2 the playhead sits at 397, three seconds before
    // it. Going back must reach event 1, not offer event 2 again.
    const parked = seekTargetFor(400)

    expect(adjacentEvent(events, parked, -1)?.eventId).toBe(1)
  })

  it('still moves forward from that same spot', () => {
    expect(adjacentEvent(events, seekTargetFor(400), 1)?.eventId).toBe(2)
  })

  it('returns nothing past the last event', () => {
    expect(adjacentEvent(events, 1_000, 1)).toBeNull()
  })

  it('returns nothing before the first', () => {
    expect(adjacentEvent(events, 10, -1)).toBeNull()
  })

  it('copes with a game that produced no markers', () => {
    expect(adjacentEvent([], 300, 1)).toBeNull()
    expect(adjacentEvent([], 300, -1)).toBeNull()
  })
})
