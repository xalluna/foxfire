import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecording, finishRecording, getRecording, markRecordingUnmatched } from '../db/repositories/recordings.repo'
import { insertMatch } from '../db/repositories/matches.repo'
import { applyAllMigrations } from '../db/testMigrations'
import type { MatchDto } from '../riot/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

// A real in-memory database behind getDb, so the binding pass runs against the
// SQL that ships rather than a stubbed repository.
const live = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../db', () => ({ getDb: () => live.db }))

// The account context reaches the API layer, which reaches Electron. These
// tests are about what the service does with the answer, not where it came
// from — the Riot ID is here so the "claimed by either handle" predicate is
// exercised rather than bypassed.
vi.mock('../api/accountContext', () => ({
  accountContext: (accountId: string) =>
    Promise.resolve({ accountId, riotId: 'Alluna#NA1', serverKey: null })
}))

vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, error: () => {} })
}))

// Broadcasting a change and reading the recording folder are both beside the point
// here, and both would pull Electron in.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { showItemInFolder: () => {} }
}))
vi.mock('./captureSettings', () => ({ getCaptureSettings: () => ({ softCapBytes: 0 }) }))

const { bindPendingRecordings } = await import('./recordingService')

const ME = 'puuid-me'
const ACCOUNT = '1'
const T0 = 1_700_000_000_000
const MINUTE = 60_000
/** Seconds, as the schema stores it — 25 minutes. */
const DURATION = 1500
/** The ten champions on the scoreboard, in the order the live client listed them. */
const ROSTER = [112, 64, 51, 412, 875, 1, 2, 3, 4, 5]
/** Long enough after the recording that the give-up deadline has passed. */
const LATER = T0 + DURATION * 1000 + 2 * 60 * MINUTE

let db: DatabaseSyncType

function participant(championId: number, index: number): unknown {
  return {
    puuid: index === 0 ? ME : `puuid-other-${index}`,
    riotIdGameName: index === 0 ? 'Alluna' : `Other${index}`,
    riotIdTagline: 'NA1',
    teamId: index < 5 ? 100 : 200,
    win: index < 5,
    championId,
    championName: `Champion${championId}`,
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
}

/** The match the recording above is of — same ten champions, same finish time. */
function match(matchId: string, gameCreation = T0): MatchDto {
  return {
    metadata: { matchId, participants: [ME] },
    info: {
      gameCreation,
      gameDuration: DURATION,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      queueId: 420,
      platformId: 'NA1',
      participants: ROSTER.map(participant)
    }
  } as unknown as MatchDto
}

/** A recording that has stopped, which is what makes it a candidate for binding. */
function finishedRecording(name = 'game'): number {
  // Nothing here writes a file, so the path only has to be unique.
  const path = `recording-${name}.mp4`
  const id = createRecording(db, {
    accountId: ACCOUNT,
    riotId: 'Alluna#NA1',
    serverKey: null,
    filePath: path,
    queueId: 420,
    startedAt: T0,
    gameTimeOffset: 42.5,
    selfChampionId: ROSTER[0],
    roster: ROSTER
  })
  finishRecording(db, id, T0 + DURATION * 1000, path, 1)
  return id
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyAllMigrations(db)
  db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run(
    ME,
    'Alluna',
    'NA1'
  )
  live.db = db
  vi.useFakeTimers()
  vi.setSystemTime(LATER)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bindPendingRecordings', () => {
  it('gives a recording the match that arrived after it', async () => {
    const id = finishedRecording()
    insertMatch(db, match('NA1_1'))

    expect(await bindPendingRecordings(ACCOUNT)).toBe(1)
    expect(getRecording(db, id)?.bindState).toBe('bound')
    expect(getRecording(db, id)?.matchId).toBe('NA1_1')
  })

  it('will not write a recording off on a pass that cannot vouch for the sync', async () => {
    // The stale-key case. The match is missing because nothing could be fetched,
    // not because the game does not exist, and the recording is already hours
    // past the give-up deadline by the time a new key is pasted in.
    const id = finishedRecording()

    expect(await bindPendingRecordings(ACCOUNT)).toBe(0)
    expect(getRecording(db, id)?.bindState).toBe('pending')

    expect(await bindPendingRecordings(ACCOUNT, { allowGiveUp: false })).toBe(0)
    expect(getRecording(db, id)?.bindState).toBe('pending')
  })

  it('writes a recording off once a clean sync has looked and found nothing', async () => {
    const id = finishedRecording()

    expect(await bindPendingRecordings(ACCOUNT, { allowGiveUp: true })).toBe(0)
    expect(getRecording(db, id)?.bindState).toBe('unmatched')
  })

  it('does not write off a recording that has not waited long enough yet', async () => {
    const id = finishedRecording()
    vi.setSystemTime(T0 + DURATION * 1000 + MINUTE)

    expect(await bindPendingRecordings(ACCOUNT, { allowGiveUp: true })).toBe(0)
    expect(getRecording(db, id)?.bindState).toBe('pending')
  })

  it('picks a written-off recording back up when its match finally appears', async () => {
    // The recovery that used to be impossible: nothing ever read a row again
    // once it had been marked unmatched.
    const id = finishedRecording()
    markRecordingUnmatched(db, id)

    insertMatch(db, match('NA1_1'))

    expect(await bindPendingRecordings(ACCOUNT)).toBe(1)
    expect(getRecording(db, id)?.bindState).toBe('bound')
    expect(getRecording(db, id)?.matchId).toBe('NA1_1')
  })

  it('leaves a written-off recording alone once it has aged past the retry horizon', async () => {
    const id = finishedRecording()
    markRecordingUnmatched(db, id)
    insertMatch(db, match('NA1_1'))

    // Two weeks on, a recording nothing has ever matched is a Practice Tool game.
    vi.setSystemTime(T0 + 14 * 24 * 60 * MINUTE)

    expect(await bindPendingRecordings(ACCOUNT)).toBe(0)
    expect(getRecording(db, id)?.bindState).toBe('unmatched')
  })

  it('does not let two recordings claim the same game', async () => {
    const first = finishedRecording('first')
    const second = finishedRecording('second')
    insertMatch(db, match('NA1_1'))

    expect(await bindPendingRecordings(ACCOUNT)).toBe(1)
    const states = [first, second].map((id) => getRecording(db, id)?.bindState)
    expect(states.filter((state) => state === 'bound')).toHaveLength(1)
  })
})
