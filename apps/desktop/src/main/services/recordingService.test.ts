import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRecording,
  finishRecording,
  getRecording,
  insertRecordingEvents,
  markFileDeleted,
  markRecordingUnmatched,
  setServerCopy
} from '../db/repositories/recordings.repo'
import { enqueueUpload, getUpload } from '../db/repositories/mediaUploads.repo'
import { insertMatch } from '../db/repositories/matches.repo'
import { CH } from '../ipc/channels'
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
    Promise.resolve({ accountId, riotId: 'Faker#NA1', serverKey: null })
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

// What the windows are told, so a batch can be held to telling them once.
const told = vi.hoisted(() => ({ channels: [] as string[] }))
vi.mock('../ipc/broadcast', () => ({
  broadcast: (channel: string) => {
    told.channels.push(channel)
  }
}))

// Local-only, which is the mode these tests are about: the binding pass reads
// this machine's matches, and the server path is a different set of candidates
// through the same fingerprint. The service reaches for the connection to know
// which, and the real one holds an encrypted credential store.
vi.mock('./serverService', () => ({
  isServerMode: () => false,
  getServerState: () => ({ activeUrl: null }),
  authedRequest: () => Promise.reject(new Error('not connected')),
  serverApi: () => ({ accounts: { mine: () => Promise.resolve([]) } })
}))

// What a settled recording sets off — an automatic upload — is the queue's
// business and has its own tests; here it only has to be called, and must not
// reach the network or the secret store.
const settled = vi.hoisted(() => ({ ids: [] as number[] }))
vi.mock('../media/autoUpload', () => ({
  onRecordingSettled: (id: number) => {
    settled.ids.push(id)
  }
}))
// The queue's own tests cover stopping an upload; here it only has to be
// asked, once, for the whole batch, before anything is deleted.
const queue = vi.hoisted(() => ({ released: [] as number[][] }))
vi.mock('../media/queue', () => ({
  releaseUploads: (ids: readonly number[]) => {
    queue.released.push([...ids])
    return false
  },
  announceQueue: () => {}
}))

const {
  bindPendingRecordings,
  forgetRecording,
  forgetRecordings,
  forgetServerOnlyRecordings,
  removeOldestRecordings,
  removeRecording
} = await import('./recordingService')

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
    riotIdGameName: index === 0 ? 'Faker' : `Other${index}`,
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
    riotId: 'Faker#NA1',
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
    'Faker',
    'NA1'
  )
  live.db = db
  settled.ids = []
  told.channels = []
  queue.released = []
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

describe('what settling a recording sets off', () => {
  it('offers a newly bound recording to the server', async () => {
    const id = finishedRecording()
    insertMatch(db, match('NA1_1'))

    await bindPendingRecordings(ACCOUNT)

    expect(settled.ids).toEqual([id])
  })

  it('says when one was given up on too — which the upload then leaves, having no game', async () => {
    const id = finishedRecording()

    await bindPendingRecordings(ACCOUNT, { allowGiveUp: true })

    expect(settled.ids).toEqual([id])
  })

  it('sets off nothing on a pass that changed nothing', async () => {
    finishedRecording()
    await bindPendingRecordings(ACCOUNT)
    expect(settled.ids).toEqual([])
  })
})

describe('deleting a recording', () => {
  const ON_SERVER = { videoId: 'abcdefghijk', serverKey: 'https://foxfire.example.com', at: T0 }

  it('takes the row with the file when the recording is only on this disk', () => {
    const id = finishedRecording()
    removeRecording(id)
    expect(getRecording(db, id)).toBeNull()
  })

  it('keeps a recording that is on the server, markers and all, and only frees the disk', () => {
    const id = finishedRecording()
    db.prepare(
      "INSERT INTO recording_events (recording_id, event_id, name, game_time, video_time, role, label) VALUES (?, 1, 'ChampionKill', 300, 257.5, 'kill', 'Ahri')"
    ).run(id)
    setServerCopy(db, id, ON_SERVER)

    removeRecording(id)

    const kept = getRecording(db, id)
    expect(kept?.fileDeleted).toBe(true)
    expect(kept?.fileExists).toBe(false)
    expect(kept?.server?.videoId).toBe('abcdefghijk')
    expect(db.prepare('SELECT COUNT(*) AS n FROM recording_events WHERE recording_id = ?').get(id)).toEqual({ n: 1 })
  })

  it('forgets the row once asked to, file or no file', () => {
    const id = finishedRecording()
    setServerCopy(db, id, ON_SERVER)
    removeRecording(id)

    forgetRecording(id)

    expect(getRecording(db, id)).toBeNull()
  })
})

describe('forgetting and deleting many at once', () => {
  const ON_SERVER = { videoId: 'abcdefghijk', serverKey: 'https://foxfire.example.com', at: T0 }
  let folder: string

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'foxfire-forget-'))
  })

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  /** A finished recording whose file is really on this PC. */
  function withFile(
    name: string,
    startedAt = T0,
    owner: { accountId: string; riotId: string | null } = { accountId: ACCOUNT, riotId: 'Faker#NA1' }
  ): { id: number; path: string } {
    const path = join(folder, `${name}.mp4`)
    writeFileSync(path, 'not really a video')
    const id = createRecording(db, {
      ...owner,
      serverKey: null,
      filePath: path,
      queueId: 420,
      startedAt,
      gameTimeOffset: 0,
      selfChampionId: ROSTER[0],
      roster: ROSTER
    })
    finishRecording(db, id, startedAt + DURATION * 1000, path, 1_000_000)
    return { id, path }
  }

  /** Uploaded, and its file deleted from this PC after: the row is all that is left here. */
  function serverOnly(name: string): number {
    const id = finishedRecording(name)
    setServerCopy(db, id, ON_SERVER)
    markFileDeleted(db, id, T0 + DURATION * 1000)
    return id
  }

  function markersOf(id: number): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM recording_events WHERE recording_id = ?').get(id) as { n: number }).n
  }

  const changes = (): number => told.channels.filter((channel) => channel === CH.recordings.changed).length

  it('takes every row asked for with its markers and upload, and tells the windows once', () => {
    const ids = ['a', 'b', 'c'].map(serverOnly)
    for (const id of ids) {
      insertRecordingEvents(db, id, [
        { eventId: 1, name: 'ChampionKill', gameTime: 300, videoTime: 257.5, role: 'kill', label: 'Ahri' }
      ])
      enqueueUpload(
        db,
        { recordingId: id, serverKey: ON_SERVER.serverKey, trigger: 'bulk', deleteAfter: true, fileBytes: 1, fileMtime: T0 },
        T0
      )
    }

    expect(forgetRecordings(ids)).toEqual({ forgotten: 3, kept: 0 })

    for (const id of ids) {
      expect(getRecording(db, id)).toBeNull()
      expect(markersOf(id)).toBe(0)
      expect(getUpload(db, id)).toBeNull()
    }
    // One redraw for the batch, not one a row — and the uploads let go of
    // together, before anything was deleted.
    expect(changes()).toBe(1)
    expect(queue.released).toEqual([ids])
  })

  it('forgets every recording that lives only on the server, and nothing with a file here', () => {
    const a = serverOnly('a')
    const b = serverOnly('b')
    // On the server with its file still here; only on this PC; and gone
    // missing with no copy anywhere — none of them is the server's alone.
    const uploaded = withFile('uploaded')
    setServerCopy(db, uploaded.id, ON_SERVER)
    const local = withFile('local')
    const missing = finishedRecording('missing')

    expect(forgetServerOnlyRecordings()).toEqual({ forgotten: 2, kept: 0 })

    expect(getRecording(db, a)).toBeNull()
    expect(getRecording(db, b)).toBeNull()
    for (const id of [uploaded.id, local.id, missing]) expect(getRecording(db, id)).not.toBeNull()
    expect(existsSync(uploaded.path)).toBe(true)
    expect(existsSync(local.path)).toBe(true)
    expect(changes()).toBe(1)
  })

  it('deletes the file of a recording picked by hand that still has one, as forgetting one always has', () => {
    const picked = withFile('picked')

    expect(forgetRecordings([picked.id])).toEqual({ forgotten: 1, kept: 0 })
    expect(getRecording(db, picked.id)).toBeNull()
    expect(existsSync(picked.path)).toBe(false)
  })

  it('keeps the row of a file it could not delete, rather than leave the file with nothing pointing at it', () => {
    // A folder where the file should be will not go as a file does — the
    // stand-in for a video a player still has open.
    const path = join(folder, 'open.mp4')
    mkdirSync(path)
    const open = createRecording(db, {
      accountId: ACCOUNT,
      riotId: 'Faker#NA1',
      serverKey: null,
      filePath: path,
      queueId: 420,
      startedAt: T0,
      gameTimeOffset: 0,
      selfChampionId: ROSTER[0],
      roster: ROSTER
    })
    finishRecording(db, open, T0 + 1_000, path, 1)
    const other = serverOnly('other')

    expect(forgetRecordings([open, other])).toEqual({ forgotten: 1, kept: 1 })
    expect(getRecording(db, open)).not.toBeNull()
    expect(getRecording(db, other)).toBeNull()
  })

  it('tells nobody anything when there was nothing to forget', () => {
    finishedRecording('local')

    expect(forgetRecordings([])).toEqual({ forgotten: 0, kept: 0 })
    expect(forgetServerOnlyRecordings()).toEqual({ forgotten: 0, kept: 0 })
    expect(told.channels).toEqual([])
  })

  it('cleans up the oldest files on this PC whoever played them, and tells the windows once', () => {
    // The other accounts' games are the oldest: the ones the cleanup, when it
    // was the picked account's, never reached.
    const smurf = withFile('smurf', T0, { accountId: '2', riotId: 'Smurf#EUW' })
    const someone = withFile('someone', T0 + MINUTE, { accountId: '0198f2c1-guid', riotId: 'Someone#EUW' })
    const mine = withFile('mine', T0 + 2 * MINUTE)

    expect(removeOldestRecordings(2)).toBe(2)

    expect(getRecording(db, smurf.id)).toBeNull()
    expect(getRecording(db, someone.id)).toBeNull()
    expect(existsSync(smurf.path)).toBe(false)
    expect(existsSync(someone.path)).toBe(false)
    expect(getRecording(db, mine.id)).not.toBeNull()
    expect(changes()).toBe(1)
  })
})
