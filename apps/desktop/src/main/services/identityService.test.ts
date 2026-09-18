import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccountById, listRetiredPuuids } from '../db/repositories/accounts.repo'
import { applyAllMigrations } from '../db/testMigrations'
import { RiotApiError } from '../riot/rateLimiter'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

// A real in-memory database behind getDb, so the rekey runs against the SQL
// that ships rather than a stubbed repository.
const live = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../db', () => ({ getDb: () => live.db }))

vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, error: () => {} })
}))

// The real module reaches the telemetry recorder, and through it Electron.
vi.mock('../riot/client', () => ({
  isNotFound: (err: unknown) => err instanceof RiotApiError && err.status === 404
}))

const resolveRiotId = vi.hoisted(() => vi.fn())
vi.mock('../riot/endpoints/account', () => ({ getAccountByRiotId: resolveRiotId }))

const { repairAccountIdentity, repairAllIdentities } = await import('./identityService')

const OLD = 'puuid-old-key'
const NEW = 'puuid-new-key'

function insertAccountRow(db: DatabaseSyncType, puuid: string, gameName: string): number {
  const result = db
    .prepare(
      `INSERT INTO accounts (puuid, game_name, tag_line, platform, regional_route)
       VALUES (?, ?, 'NA1', 'na1', 'americas')`
    )
    .run(puuid, gameName)
  return Number(result.lastInsertRowid)
}

describe('repairAccountIdentity', () => {
  let db: DatabaseSyncType
  let accountId: number

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    live.db = db
    accountId = insertAccountRow(db, OLD, 'Alluna')
    resolveRiotId.mockReset()
  })

  it('reports nothing to do when the key resolves the same puuid', async () => {
    resolveRiotId.mockResolvedValue({ puuid: OLD, gameName: 'Alluna', tagLine: 'NA1' })

    expect(await repairAccountIdentity(accountId)).toBe('unchanged')
    expect(listRetiredPuuids(db, accountId)).toEqual([])
  })

  it('moves the account onto the puuid the new key issued', async () => {
    resolveRiotId.mockResolvedValue({ puuid: NEW, gameName: 'Alluna', tagLine: 'NA1' })

    expect(await repairAccountIdentity(accountId)).toBe('repaired')
    expect(getAccountById(db, accountId)?.puuid).toBe(NEW)
    expect(listRetiredPuuids(db, accountId)).toEqual([OLD])
  })

  it('asks Riot by the stored Riot ID, the one handle a key change cannot invalidate', async () => {
    resolveRiotId.mockResolvedValue({ puuid: NEW, gameName: 'Alluna', tagLine: 'NA1' })

    await repairAccountIdentity(accountId)

    expect(resolveRiotId).toHaveBeenCalledWith('americas', 'Alluna', 'NA1')
  })

  it('reports a Riot ID Riot no longer knows, and keeps the account intact', async () => {
    resolveRiotId.mockRejectedValue(new RiotApiError('Not found', 404))

    expect(await repairAccountIdentity(accountId)).toBe('unresolved')
    expect(getAccountById(db, accountId)?.puuid).toBe(OLD)
    expect(listRetiredPuuids(db, accountId)).toEqual([])
  })

  it('throws when Riot could not be asked, rather than retiring a good puuid', async () => {
    resolveRiotId.mockRejectedValue(new RiotApiError('Riot API error 401', 401))

    await expect(repairAccountIdentity(accountId)).rejects.toThrow('401')
    expect(getAccountById(db, accountId)?.puuid).toBe(OLD)
  })
})

describe('repairAllIdentities', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    live.db = db
    insertAccountRow(db, OLD, 'Alluna')
    insertAccountRow(db, 'puuid-old-smurf', 'Alluna Smurf')
    resolveRiotId.mockReset()
  })

  it('reports every account, and one failure does not stop the rest', async () => {
    resolveRiotId
      .mockRejectedValueOnce(new RiotApiError('Riot API error 500', 500))
      .mockResolvedValueOnce({ puuid: NEW, gameName: 'Alluna Smurf', tagLine: 'NA1' })

    const reports = await repairAllIdentities()

    expect(reports).toEqual([
      { accountId: '1', riotId: 'Alluna#NA1', outcome: 'failed' },
      { accountId: '2', riotId: 'Alluna Smurf#NA1', outcome: 'repaired' }
    ])
  })
})
