import type { MatchRecording, MatchSummary, RecordingEvent, RecordingStatus } from '@foxfire/core'
import { renderRecordingTitle, DEFAULT_TITLE_TEMPLATE } from '@foxfire/core/recordings'

/**
 * Recordings on the server, for the harness.
 *
 * Foxfire Media's ids are eleven characters; this one only ever reaches the
 * harness's own stand-in player.
 */
export const FIXTURE_VIDEO_ID = 'fixtureVid1'

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

/** The title the upload queue would give a fixture row. */
export function fixtureTitle(match: MatchSummary): string {
  return renderRecordingTitle(DEFAULT_TITLE_TEMPLATE, {
    champion: match.championName ?? 'Viktor',
    queueId: match.queueId,
    gameMode: match.gameMode,
    win: match.win,
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    playedAt: match.gameCreation
  })
}

/** A recording as the server would hold it, for one of the fixture rows. */
export function fixtureRecording(match: MatchSummary, status: RecordingStatus = 'ready'): MatchRecording {
  const uploadedAt = match.gameCreation + match.gameDuration * 1000 + 20 * 60_000
  return {
    videoId: FIXTURE_VIDEO_ID,
    status,
    hasEvents: true,
    durationSeconds: status === 'ready' ? match.gameDuration - 30 : null,
    title: fixtureTitle(match),
    error: status === 'failed' ? 'The file has no video stream.' : null,
    attachedBy: 'Faker',
    attachedAt: new Date(uploadedAt).toISOString(),
    readyAt: status === 'ready' ? new Date(uploadedAt + 4 * 60_000).toISOString() : null,
    events: fixtureEvents(match)
  }
}
