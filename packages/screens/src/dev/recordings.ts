import type { MatchRecording, MatchSummary, RecordingEvent } from '@foxfire/core'
import { buildRecordingDescription, renderRecordingTitle, DEFAULT_TITLE_TEMPLATE } from '@foxfire/core/youtube'
import { scenario } from './scenario'

/**
 * Recordings on YouTube, for the harness.
 *
 * A real, embeddable video id — Blender's Big Buck Bunny — so pointing a real
 * YouTube mount at the fixtures plays something. The harness's own mount never
 * reaches YouTube at all.
 */
export const FIXTURE_VIDEO_ID = 'aqz-KE-bpKQ'

const VICTIMS = ['Zed', 'Syndra', 'LeBlanc', 'Orianna', 'Yasuo', 'Akali', 'Sylas', 'Azir']

/**
 * A believable timeline for a game: its kills, deaths and assists spread across
 * the length of it, and a multikill where the row says there was one.
 *
 * Deterministic, so the markers are in the same place on every reload and a
 * layout can be judged against them.
 */
export function fixtureEvents(match: MatchSummary): RecordingEvent[] {
  const length = Math.max(300, match.gameDuration - 90)
  const events: RecordingEvent[] = []
  let eventId = 1

  const spread = (count: number, role: RecordingEvent['role'], nudge: number): void => {
    for (let i = 0; i < count; i++) {
      const videoTime = Math.round(45 + ((length - 60) * (i + 0.5)) / count + nudge)
      events.push({
        eventId: eventId++,
        name: 'ChampionKill',
        gameTime: videoTime + 38,
        videoTime,
        role,
        label: VICTIMS[(i + eventId) % VICTIMS.length]!
      })
    }
  }

  spread(match.kills, 'kill', 0)
  spread(match.deaths, 'death', 23)
  spread(Math.min(match.assists, 8), 'assist', 51)

  const firstKill = events.find((event) => event.role === 'kill')
  if (firstKill && (match.largestMultiKill ?? 1) >= 2) {
    events.push({
      eventId: eventId++,
      name: 'Multikill',
      gameTime: firstKill.gameTime + 4,
      videoTime: firstKill.videoTime + 4,
      role: 'multikill',
      label: String(match.largestMultiKill)
    })
  }

  return events.sort((a, b) => a.videoTime - b.videoTime)
}

/** A recording as the server would hold it, for one of the fixture rows. */
export function fixtureRecording(match: MatchSummary, source: 'upload' | 'link'): MatchRecording {
  const events = source === 'upload' ? fixtureEvents(match) : []
  const title = renderRecordingTitle(DEFAULT_TITLE_TEMPLATE, {
    champion: match.championName ?? 'Viktor',
    queueId: match.queueId,
    gameMode: match.gameMode,
    win: match.win,
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    playedAt: match.gameCreation
  })

  return {
    youtubeVideoId: FIXTURE_VIDEO_ID,
    privacy: source === 'link' ? null : scenario === 'recording-private' ? 'private' : 'unlisted',
    hasEvents: source === 'upload',
    title,
    durationSeconds: match.gameDuration - 30,
    source,
    attachedBy: 'Faker',
    attachedAt: new Date(match.gameCreation + match.gameDuration * 1000 + 20 * 60_000).toISOString(),
    events
  }
}

/** The description the upload form would prefill for a fixture row, for the desktop's mock. */
export function fixtureDescription(match: MatchSummary): string {
  return buildRecordingDescription(fixtureEvents(match))
}
