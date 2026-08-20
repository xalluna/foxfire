import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  bindRecording,
  countMissingFiles,
  createRecording,
  deleteRecording,
  finishRecording,
  getOldestRecordingIds,
  getBindableRecordings,
  getRecording,
  getRecordingEvents,
  getRecordingFilePath,
  getRecordingUsage,
  getRecordings,
  insertRecordingEvents,
  markRecordingUnmatched,
  matchAlreadyBound
} from './recordings.repo'
import { getMatchSummaries, insertMatch } from './matches.repo'
import { applyAllMigrations } from '../testMigrations'
import type { MatchDto } from '../../riot/types'
import type { RecordingEvent } from '@shared/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const ME = 'puuid-me'
const T0 = 1_700_000_000_000

/** A retry cutoff old enough to reconsider every written-off recording here. */
const WITHIN_HORIZON = T0 - 1
/** A cutoff recent enough that a recording made at T0 has aged out of it. */
const PAST_HORIZON = T0 + 1

/** Nothing in these tests writes a file, so every path is a missing one. */
const FILE = 'C:\\Videos\\Foxfire\\2026-08-18 20-14-03.mp4'

let db: DatabaseSyncType

function seedAccount(): number {
  db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(
    ME,
    'Alluna',
    'NA1'
  )
  return 1
}

function match(matchId: string, gameCreation: number): MatchDto {
  return {
    metadata: { matchId, participants: [ME] },
    info: {
      gameCreation,
      gameDuration: 1669,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      queueId: 420,
      platformId: 'NA1',
      participants: [
        {
          puuid: ME,
          riotIdGameName: 'Alluna',
          riotIdTagline: 'NA1',
          teamId: 100,
          win: true,
          championId: 112,
          championName: 'Viktor',
          champLevel: 15,
          kills: 7,
          deaths: 2,
          assists: 9,
          goldEarned: 11_000,
          totalMinionsKilled: 200,
          neutralMinionsKilled: 43,
          totalDamageDealtToChampions: 18_900,
          totalDamageTaken: 20_100,
          item0: 1056,
          item1: 3157,
          item2: 3100,
          item3: 2503,
          item4: 3067,
          item5: 3363,
          item6: 3009,
          summoner1Id: 12,
          summoner2Id: 4,
          teamPosition: 'MIDDLE',
          largestMultiKill: 2,
          perks: { statPerks: {}, styles: [] }
        }
      ]
    }
  } as unknown as MatchDto
}

function newRecording(over: Partial<Parameters<typeof createRecording>[1]> = {}): number {
  return createRecording(db, {
    accountId: 1,
    filePath: FILE,
    queueId: 420,
    startedAt: T0,
    gameTimeOffset: 42.5,
    selfChampionId: 112,
    roster: [112, 64, 51, 412, 875, 1, 2, 3, 4, 5],
    ...over
  })
}

function event(over: Partial<RecordingEvent> = {}): RecordingEvent {
  return {
    eventId: 1,
    name: 'ChampionKill',
    gameTime: 142.5,
    videoTime: 100,
    role: 'kill',
    label: 'Enemy',
    ...over
  }
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyAllMigrations(db)
  seedAccount()
})

describe('recordings.repo', () => {
  it('starts a recording unbound, because the match does not exist yet', () => {
    const id = newRecording()
    const recording = getRecording(db, id)

    expect(recording?.bindState).toBe('pending')
    expect(recording?.matchId).toBeNull()
    expect(recording?.match).toBeNull()
    // Still in progress — an end time is what makes it a candidate for binding.
    expect(recording?.endedAt).toBeNull()
    expect(recording?.durationSeconds).toBeNull()
  })

  it('reports a file that is not on disk as missing rather than hiding the recording', () => {
    const id = newRecording()

    expect(getRecording(db, id)?.fileExists).toBe(false)
    expect(countMissingFiles(db)).toBe(1)
  })

  it('takes the filename from the stop, because OBS chooses it and not us', () => {
    const id = newRecording({ filePath: 'pending-unknown-name' })
    finishRecording(db, id, T0 + 1_800_000, FILE, 2_400_000_000)

    const recording = getRecording(db, id)
    expect(getRecordingFilePath(db, id)).toBe(FILE)
    expect(recording?.fileBytes).toBe(2_400_000_000)
    expect(recording?.durationSeconds).toBe(1800)
  })

  it('ignores events it has already stored, since every poll resends the whole list', () => {
    const id = newRecording()

    insertRecordingEvents(db, id, [event({ eventId: 1 }), event({ eventId: 2, videoTime: 210 })])
    // The next poll a second later returns both of those again plus a new one.
    insertRecordingEvents(db, id, [
      event({ eventId: 1 }),
      event({ eventId: 2, videoTime: 210 }),
      event({ eventId: 3, videoTime: 260, role: 'death' })
    ])

    const events = getRecordingEvents(db, id)
    expect(events.map((e) => e.eventId)).toEqual([1, 2, 3])
    expect(events[2]?.role).toBe('death')
  })

  it('returns events in video order, which is the order the timeline draws them', () => {
    const id = newRecording()
    insertRecordingEvents(db, id, [
      event({ eventId: 9, videoTime: 900 }),
      event({ eventId: 4, videoTime: 120 }),
      event({ eventId: 7, videoTime: 500 })
    ])

    expect(getRecordingEvents(db, id).map((e) => e.videoTime)).toEqual([120, 500, 900])
  })

  it('surfaces the bound match on the recording, so the list needs one query', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    finishRecording(db, id, T0 + 1_800_000, FILE, 100)
    bindRecording(db, id, 'NA1_1')

    const recording = getRecording(db, id)
    expect(recording?.bindState).toBe('bound')
    expect(recording?.match?.championName).toBe('Viktor')
    expect(recording?.match?.kills).toBe(7)
    expect(recording?.match?.win).toBe(true)
  })

  it('offers only finished, still-unbound recordings for binding', () => {
    const running = newRecording()
    const finished = newRecording({ filePath: 'b.mp4' })
    const already = newRecording({ filePath: 'c.mp4' })
    finishRecording(db, finished, T0 + 1_000, 'b.mp4', 1)
    finishRecording(db, already, T0 + 1_000, 'c.mp4', 1)
    insertMatch(db, match('NA1_1', T0))
    bindRecording(db, already, 'NA1_1')

    const pending = getBindableRecordings(db, 1, WITHIN_HORIZON)
    expect(pending.map((p) => p.id)).toEqual([finished])
    expect(pending.map((p) => p.id)).not.toContain(running)
    expect(pending[0]?.roster).toHaveLength(10)
  })

  it('offers a recording it gave up on again, in case the match was only missing', () => {
    // Giving up says a match could not be found, which is not the same as one
    // not existing: an expired API key means nothing was there to find yet.
    const id = newRecording()
    finishRecording(db, id, T0 + 1_000, FILE, 1)
    markRecordingUnmatched(db, id)

    expect(getBindableRecordings(db, 1, WITHIN_HORIZON).map((p) => p.id)).toEqual([id])
    expect(getRecording(db, id)?.bindState).toBe('unmatched')
  })

  it('stops offering a written-off recording once it has aged past the horizon', () => {
    // A Practice Tool game has no match and never will. Without this cutoff it
    // would be rescanned on every sync for the life of the library.
    const id = newRecording()
    finishRecording(db, id, T0 + 1_000, FILE, 1)
    markRecordingUnmatched(db, id)

    expect(getBindableRecordings(db, 1, PAST_HORIZON)).toHaveLength(0)
  })

  it('never re-offers a bound recording, however recent it is', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    finishRecording(db, id, T0 + 1_000, FILE, 1)
    bindRecording(db, id, 'NA1_1')

    expect(getBindableRecordings(db, 1, WITHIN_HORIZON)).toHaveLength(0)
  })

  it('knows a match is spoken for, so two recordings cannot claim one game', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    expect(matchAlreadyBound(db, 'NA1_1')).toBe(false)

    bindRecording(db, id, 'NA1_1')
    expect(matchAlreadyBound(db, 'NA1_1')).toBe(true)
  })

  it('keeps the footage when the match is deleted, dropping only the link', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    bindRecording(db, id, 'NA1_1')

    db.prepare('DELETE FROM matches WHERE match_id = ?').run('NA1_1')

    // ON DELETE SET NULL, deliberately not CASCADE — losing a match row must
    // never destroy a recording.
    const recording = getRecording(db, id)
    expect(recording).not.toBeNull()
    expect(recording?.matchId).toBeNull()
  })

  it('takes its events with it when a recording is deleted', () => {
    const id = newRecording()
    insertRecordingEvents(db, id, [event()])

    expect(deleteRecording(db, id)).toBe(FILE)
    expect(getRecording(db, id)).toBeNull()
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM recording_events WHERE recording_id = ?')
      .get(id) as unknown as { n: number }
    expect(rows.n).toBe(0)
  })

  it('hands the match list a recording id, which is all its context menu needs', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    bindRecording(db, id, 'NA1_1')

    const [summary] = getMatchSummaries(db, ME, 10, 0)
    expect(summary?.recordingId).toBe(id)
  })

  it('leaves recordingId null on a match nothing recorded', () => {
    insertMatch(db, match('NA1_1', T0))

    const [summary] = getMatchSummaries(db, ME, 10, 0)
    expect(summary?.recordingId).toBeNull()
  })

  it('totals disk use and counts what never found a match', () => {
    const a = newRecording({ filePath: 'a.mp4' })
    const b = newRecording({ filePath: 'b.mp4' })
    finishRecording(db, a, T0 + 1_000, 'a.mp4', 1_000_000)
    finishRecording(db, b, T0 + 1_000, 'b.mp4', 3_000_000)
    markRecordingUnmatched(db, b)

    const usage = getRecordingUsage(db)
    expect(usage.totalBytes).toBe(4_000_000)
    expect(usage.count).toBe(2)
    expect(usage.unmatchedCount).toBe(1)
  })

  it('deletes oldest first, so cleanup keeps the games you just played', () => {
    const oldest = newRecording({ filePath: 'a.mp4', startedAt: T0 })
    const middle = newRecording({ filePath: 'b.mp4', startedAt: T0 + 10_000 })
    newRecording({ filePath: 'c.mp4', startedAt: T0 + 20_000 })

    expect(getOldestRecordingIds(db, 1, 2)).toEqual([oldest, middle])
  })

  it('lists newest first, matching how match history reads', () => {
    newRecording({ filePath: 'a.mp4', startedAt: T0 })
    const newest = newRecording({ filePath: 'b.mp4', startedAt: T0 + 60_000 })

    expect(getRecordings(db, 1)[0]?.id).toBe(newest)
  })
})
