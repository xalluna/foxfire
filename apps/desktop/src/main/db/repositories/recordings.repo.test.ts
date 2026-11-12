import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bindRecording,
  countServerOnlyRecordings,
  createRecording,
  deleteRecording,
  deleteRecordings,
  finishRecording,
  getOldestRecordingIds,
  getBindableRecordings,
  getRecording,
  getRecordingEvents,
  getRecordingFilePath,
  getRecordingPlayers,
  getRecordingUsage,
  getRecordings,
  getServerOnlyRecordingIds,
  countRecordings,
  insertRecordingEvents,
  markFileDeleted,
  markRecordingUnmatched,
  matchAlreadyBound,
  setServerCopy
} from './recordings.repo'
import { enqueueUpload } from './mediaUploads.repo'
import { getMatchSummaries, insertMatch } from './matches.repo'
import { applyAllMigrations } from '../testMigrations'
import type { MatchDto } from '../../riot/types'
import type { RecordingEvent } from '@shared/types'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

import type { AccountContext } from '../accountScope'

/**
 * Whose rows these are, the way the app asks for them.
 *
 * An id and a Riot ID together, because a recording is claimed by either: the
 * id is what the store currently calls the account, and the Riot ID is what
 * still finds the row after that id changes.
 */
const ACCOUNT: AccountContext = { accountId: '1', riotId: 'Faker#NA1', serverKey: null }

/** More than any test here makes, so a read is every recording. */
const EVERY = { limit: 100, offset: 0 }

/** No filter: every recording on this PC, whoever played it. */
const ALL = {}

/** A second account on this PC, which a row made before it had a Riot ID finds its name through. */
const SMURF = { accountId: '2', riotId: null }

/** Somebody on a server, by the server's id — no account here has it. */
const SOMEONE = { accountId: '0198f2c1-3f1a-7c5e-9c3b-2c0a5f1e4d77', riotId: 'Someone#EUW' }

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
    'Faker',
    'NA1'
  )
  db.prepare('INSERT INTO accounts (puuid, game_name, tag_line) VALUES (?, ?, ?)').run('puuid-smurf', 'Smurf', 'EUW')
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
          riotIdGameName: 'Faker',
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
    accountId: '1',
    riotId: 'Faker#NA1',
    serverKey: null,
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
    finishRecording(db, id, T0 + 1_000, FILE, 1_000_000)

    expect(getRecording(db, id)?.fileExists).toBe(false)
    expect(getRecordingUsage(db).missingCount).toBe(1)
    // Nor does a file that is not there count towards the size.
    expect(getRecordingUsage(db).totalBytes).toBe(0)
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

    const pending = getBindableRecordings(db, ACCOUNT, WITHIN_HORIZON)
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

    expect(getBindableRecordings(db, ACCOUNT, WITHIN_HORIZON).map((p) => p.id)).toEqual([id])
    expect(getRecording(db, id)?.bindState).toBe('unmatched')
  })

  it('stops offering a written-off recording once it has aged past the horizon', () => {
    // A Practice Tool game has no match and never will. Without this cutoff it
    // would be rescanned on every sync for the life of the library.
    const id = newRecording()
    finishRecording(db, id, T0 + 1_000, FILE, 1)
    markRecordingUnmatched(db, id)

    expect(getBindableRecordings(db, ACCOUNT, PAST_HORIZON)).toHaveLength(0)
  })

  it('never re-offers a bound recording, however recent it is', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    finishRecording(db, id, T0 + 1_000, FILE, 1)
    bindRecording(db, id, 'NA1_1')

    expect(getBindableRecordings(db, ACCOUNT, WITHIN_HORIZON)).toHaveLength(0)
  })

  it('knows a match is spoken for, so two recordings cannot claim one game', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    expect(matchAlreadyBound(db, 'NA1_1')).toBe(false)

    bindRecording(db, id, 'NA1_1')
    expect(matchAlreadyBound(db, 'NA1_1')).toBe(true)
  })

  it('finds a recording again after the account id it was made under changes', async () => {
    // The scenario migration 013 exists for. A recording made in local-only mode
    // carries this machine's rowid; the same person joining a server is handed a
    // GUID instead, and every one of their recordings would otherwise vanish
    // from the list the moment they connected.
    //
    // gameName#tagLine is what both spellings have in common, and it is the only
    // handle that means the same thing on this machine, on that server, and on
    // whichever server they join next.
    const id = newRecording()
    finishRecording(db, id, T0 + 1_000, FILE, 1)

    const onAServer: AccountContext = {
      accountId: '0198f2c1-3f1a-7c5e-9c3b-2c0a5f1e4d77',
      riotId: 'Faker#NA1',
      serverKey: 'https://foxfire.example.com'
    }

    expect(getBindableRecordings(db, onAServer, WITHIN_HORIZON).map((r) => r.id)).toEqual([id])

    // And an account that merely shares the server is offered none of them.
    const somebodyElse: AccountContext = { ...onAServer, riotId: 'Someone#EUW' }
    expect(getBindableRecordings(db, somebodyElse, WITHIN_HORIZON)).toHaveLength(0)
  })

  it('keeps the footage and the match it names when the match row goes', () => {
    insertMatch(db, match('NA1_1', T0))
    const id = newRecording()
    bindRecording(db, id, 'NA1_1')

    db.prepare('DELETE FROM matches WHERE match_id = ?').run('NA1_1')

    // match_id used to be a foreign key that cleared itself here. Migration 013
    // dropped it, because in server mode the match it names is in somebody's
    // homelab and no constraint here could reach it.
    //
    // What is left is better rather than merely unavoidable. NA1_5312345678 is
    // Riot's own id: it still names the game after the row describing it is
    // gone, and it is still valid if the same stats.db is later pointed at a
    // server that has it. Forgetting it would have been the lossy answer.
    //
    // The join is what reports the loss: the detail comes back null, which is
    // exactly the state a recording is in between being bound and its match
    // syncing.
    const recording = getRecording(db, id)
    expect(recording).not.toBeNull()
    expect(recording?.matchId).toBe('NA1_1')
    expect(recording?.match).toBeNull()
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
    expect(summary?.local?.recordingId).toBe(id)
  })

  it('leaves recordingId null on a match nothing recorded', () => {
    insertMatch(db, match('NA1_1', T0))

    const [summary] = getMatchSummaries(db, ME, 10, 0)
    expect(summary?.local?.recordingId).toBeNull()
  })

  it('lists newest first, matching how match history reads', () => {
    newRecording({ filePath: 'a.mp4', startedAt: T0 })
    const newest = newRecording({ filePath: 'b.mp4', startedAt: T0 + 60_000 })

    expect(getRecordings(db, ALL, EVERY)[0]?.id).toBe(newest)
  })

  it('pages newest first, and counts every recording beside the page', () => {
    const ids = [0, 1, 2, 3, 4].map((i) => newRecording({ filePath: `${i}.mp4`, startedAt: T0 + i * 60_000 }))
    const newestFirst = [...ids].reverse()

    expect(getRecordings(db, ALL, { limit: 2, offset: 0 }).map((r) => r.id)).toEqual(newestFirst.slice(0, 2))
    expect(getRecordings(db, ALL, { limit: 2, offset: 2 }).map((r) => r.id)).toEqual(newestFirst.slice(2, 4))
    expect(getRecordings(db, ALL, { limit: 2, offset: 4 }).map((r) => r.id)).toEqual(newestFirst.slice(4))
    expect(countRecordings(db, ALL)).toBe(5)
    expect(countRecordings(db, { player: 'Someone#EUW' })).toBe(0)
  })

  it('breaks a tie between two recordings that started together, so no page repeats one', () => {
    const first = newRecording({ filePath: 'a.mp4', startedAt: T0 })
    const second = newRecording({ filePath: 'b.mp4', startedAt: T0 })

    const pages = [
      ...getRecordings(db, ALL, { limit: 1, offset: 0 }),
      ...getRecordings(db, ALL, { limit: 1, offset: 1 })
    ]

    expect(pages.map((r) => r.id)).toEqual([second, first])
  })
})

describe('every recording on this PC', () => {
  // The Recordings tab used to list the account picked in the rail, under a
  // size that counted everybody's: a PC full of another account's games warned
  // about files the list never showed and its cleanup never reached.

  it('lists and counts every account’s, naming the player each was recorded on', () => {
    const faker = newRecording({ filePath: 'faker.mp4', startedAt: T0 })
    const smurf = newRecording({ filePath: 'smurf.mp4', startedAt: T0 + 60_000, ...SMURF })
    const someone = newRecording({ filePath: 'someone.mp4', startedAt: T0 + 120_000, ...SOMEONE })
    const nobody = newRecording({ filePath: 'nobody.mp4', startedAt: T0 + 180_000, accountId: 'an-id-from-a-gone-server', riotId: null })

    const rows = getRecordings(db, ALL, EVERY)
    expect(rows.map((r) => r.id)).toEqual([nobody, someone, smurf, faker])
    expect(countRecordings(db, ALL)).toBe(4)

    // The row's own Riot ID; failing that, this PC's account of that id; and
    // nothing at all when neither can say.
    expect(rows.map((r) => r.riotId)).toEqual([null, 'Someone#EUW', 'Smurf#EUW', 'Faker#NA1'])
    expect(getRecording(db, smurf)?.riotId).toBe('Smurf#EUW')
  })

  it('narrows to one player, whatever the case, and to one game, and counts what it leaves', () => {
    const faker = newRecording({ filePath: 'faker.mp4', startedAt: T0 })
    const fakerTft = newRecording({ filePath: 'faker-tft.mp4', startedAt: T0 + 60_000, game: 'tft' })
    const smurf = newRecording({ filePath: 'smurf.mp4', startedAt: T0 + 120_000, ...SMURF })
    newRecording({ filePath: 'someone.mp4', startedAt: T0 + 180_000, ...SOMEONE })

    expect(getRecordings(db, { player: 'faker#na1' }, EVERY).map((r) => r.id)).toEqual([fakerTft, faker])
    expect(countRecordings(db, { player: 'FAKER#NA1' })).toBe(2)
    // A player named only through this PC's accounts is found the same way.
    expect(getRecordings(db, { player: 'Smurf#EUW' }, EVERY).map((r) => r.id)).toEqual([smurf])
    expect(getRecordings(db, { player: 'Faker#NA1', game: 'tft' }, EVERY).map((r) => r.id)).toEqual([fakerTft])
    expect(countRecordings(db, { game: 'lol' })).toBe(3)
  })

  it('offers each player once, most recordings first, and leaves out who nobody can name', () => {
    newRecording({ filePath: 'a.mp4' })
    newRecording({ filePath: 'b.mp4', riotId: 'faker#na1' })
    newRecording({ filePath: 'c.mp4', ...SMURF })
    newRecording({ filePath: 'd.mp4', accountId: 'an-id-from-a-gone-server', riotId: null })

    const players = getRecordingPlayers(db)
    expect(players.map((p) => p.count)).toEqual([2, 1])
    expect(players[0]?.riotId.toLowerCase()).toBe('faker#na1')
    expect(players[1]).toEqual({ riotId: 'Smurf#EUW', count: 1 })
  })
})

describe('what the recordings take up, and the cleanup', () => {
  let folder: string

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'foxfire-usage-'))
  })

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  /** A finished recording whose file is really there. */
  function onDisk(
    name: string,
    startedAt: number,
    bytes: number,
    owner: { accountId: string; riotId: string | null } = { accountId: '1', riotId: 'Faker#NA1' }
  ): number {
    const path = join(folder, `${name}.mp4`)
    writeFileSync(path, 'not really a video')
    const id = newRecording({ filePath: path, startedAt, ...owner })
    finishRecording(db, id, startedAt + 1_000, path, bytes)
    return id
  }

  it('totals disk use and counts what never found a match', () => {
    onDisk('a', T0, 1_000_000)
    const b = onDisk('b', T0 + 1_000, 3_000_000)
    markRecordingUnmatched(db, b)

    const usage = getRecordingUsage(db)
    expect(usage.totalBytes).toBe(4_000_000)
    expect(usage.count).toBe(2)
    expect(usage.unmatchedCount).toBe(1)
    expect(usage.missingCount).toBe(0)
  })

  it('deletes oldest first, so cleanup keeps the games you just played', () => {
    const oldest = onDisk('a', T0, 1)
    const middle = onDisk('b', T0 + 10_000, 1)
    onDisk('c', T0 + 20_000, 1)

    expect(getOldestRecordingIds(db, 2)).toEqual([oldest, middle])
  })

  it('warns about exactly the files the cleanup can reach, whoever played them', () => {
    // The other accounts' games are the oldest here — the case the old
    // cleanup, scoped to the picked account, could not touch.
    const smurf = onDisk('smurf', T0, 40_000_000, SMURF)
    const someone = onDisk('someone', T0 + 10_000, 30_000_000, SOMEONE)
    const faker = onDisk('faker', T0 + 20_000, 20_000_000)

    // Not files on this PC, so in neither the size nor the cleanup: one whose
    // file was deleted after upload, one that went missing, one still being
    // written.
    const uploaded = onDisk('uploaded', T0 - 30_000, 50_000_000)
    setServerCopy(db, uploaded, { videoId: 'v', serverKey: 'https://foxfire.example.com', at: T0 })
    rmSync(join(folder, 'uploaded.mp4'))
    markFileDeleted(db, uploaded, T0)
    const missing = onDisk('missing', T0 - 20_000, 60_000_000)
    rmSync(join(folder, 'missing.mp4'))
    newRecording({ filePath: join(folder, 'recording-now.mp4'), startedAt: T0 + 30_000 })

    const usage = getRecordingUsage(db)
    expect(usage.totalBytes).toBe(90_000_000)
    expect(usage.count).toBe(3)
    expect(usage.missingCount).toBe(1)

    expect(getOldestRecordingIds(db, 2)).toEqual([smurf, someone])
    // Asked for as many as the size counts, the cleanup reaches every one of
    // them and nothing else: no byte in the warning is out of its reach.
    expect(getOldestRecordingIds(db, usage.count)).toEqual([smurf, someone, faker])
    expect(getOldestRecordingIds(db, 100)).toEqual([smurf, someone, faker])
    expect(getOldestRecordingIds(db, 100)).not.toContain(missing)
  })
})

describe('forgetting many', () => {
  const ON_SERVER = { videoId: 'abcdefghijk', serverKey: 'https://foxfire.example.com', at: T0 }

  function countOf(table: string, recordingId: number): number {
    const column = table === 'recordings' ? 'id' : 'recording_id'
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(recordingId) as { n: number }).n
  }

  /** Recorded, uploaded, and its file deleted from this PC: the row is all that is left here. */
  function serverOnly(name: string): number {
    const id = newRecording({ filePath: `${name}.mp4` })
    finishRecording(db, id, T0 + 1_000, `${name}.mp4`, 1_000_000)
    setServerCopy(db, id, ON_SERVER)
    markFileDeleted(db, id, T0 + 2_000)
    return id
  }

  it('finds what lives only on the server: the file gone from here, the video there', () => {
    const a = serverOnly('a')
    const b = serverOnly('b')
    // On the server with its file still here: not one of them.
    const kept = newRecording({ filePath: 'kept.mp4' })
    setServerCopy(db, kept, ON_SERVER)
    // Its file gone but no server copy: forgetting it would lose the game.
    const lost = newRecording({ filePath: 'lost.mp4' })
    markFileDeleted(db, lost, T0)

    expect(getServerOnlyRecordingIds(db)).toEqual([a, b])
    expect(countServerOnlyRecordings(db)).toBe(2)
  })

  it('takes each row with its markers and upload, and leaves every other alone', () => {
    const a = serverOnly('a')
    const b = serverOnly('b')
    const other = serverOnly('other')
    for (const id of [a, b, other]) {
      insertRecordingEvents(db, id, [event({ eventId: 1 }), event({ eventId: 2, videoTime: 200 })])
      enqueueUpload(
        db,
        { recordingId: id, serverKey: ON_SERVER.serverKey, trigger: 'bulk', deleteAfter: true, fileBytes: 1, fileMtime: T0 },
        T0
      )
    }

    expect(deleteRecordings(db, [a, b, 9_999])).toBe(2)

    for (const id of [a, b]) {
      expect(countOf('recordings', id)).toBe(0)
      expect(countOf('recording_events', id)).toBe(0)
      expect(countOf('media_uploads', id)).toBe(0)
    }
    expect(countOf('recordings', other)).toBe(1)
    expect(countOf('recording_events', other)).toBe(2)
    expect(countOf('media_uploads', other)).toBe(1)
  })

  it('takes nothing when asked for nothing', () => {
    serverOnly('a')
    expect(deleteRecordings(db, [])).toBe(0)
    expect(countRecordings(db, ALL)).toBe(1)
  })
})
