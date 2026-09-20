import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { listSeasons, saveSeasons } from './seasons.repo'
import { applyAllMigrations } from '../testMigrations'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const JAN_2027 = new Date(2027, 0, 8).getTime()
const DEC_2026 = new Date(2026, 11, 22).getTime()

describe('seasons', () => {
  let db: DatabaseSyncType

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
  })

  it('ships one season so a fresh install has somewhere to file every game', () => {
    const seeded = listSeasons(db)
    expect(seeded).toHaveLength(1)
    expect(seeded[0]).toMatchObject({ label: 'Season 2026', isPreseason: false, resetsRank: true })
  })

  it('returns them oldest first, which every lookup assumes', () => {
    const [seed] = listSeasons(db)
    saveSeasons(db, [
      seed,
      { label: 'Season 2027', startsAt: JAN_2027, isPreseason: false, resetsRank: true },
      { label: 'Preseason 2027', startsAt: DEC_2026, isPreseason: true, resetsRank: false }
    ])

    expect(listSeasons(db).map((s) => s.label)).toEqual([
      'Season 2026',
      'Preseason 2027',
      'Season 2027'
    ])
  })

  it('keeps ids stable across a save, so a picker selection does not move', () => {
    const before = listSeasons(db)
    const saved = saveSeasons(db, [
      { ...before[0], label: 'Season 2026 (renamed)' },
      { label: 'Season 2027', startsAt: JAN_2027, isPreseason: false, resetsRank: true }
    ])

    // `season:<id>` is how a selected period crosses IPC. Reassigning ids on
    // every save would silently move the user onto a different season.
    expect(saved[0].id).toBe(before[0].id)
    expect(saved[0].label).toBe('Season 2026 (renamed)')
    expect(saved[1].id).not.toBe(before[0].id)
  })

  it('deletes rows the editor dropped', () => {
    const withTwo = saveSeasons(db, [
      ...listSeasons(db),
      { label: 'Season 2027', startsAt: JAN_2027, isPreseason: false, resetsRank: true }
    ])
    expect(withTwo).toHaveLength(2)

    expect(saveSeasons(db, [withTwo[1]]).map((s) => s.label)).toEqual(['Season 2027'])
  })

  it('lets a start date move onto one another row is giving up', () => {
    // Deleting before updating is what makes this work: done the other way the
    // UNIQUE index on starts_at rejects the swap partway through.
    const [seed] = listSeasons(db)
    const two = saveSeasons(db, [
      seed,
      { label: 'Season 2027', startsAt: JAN_2027, isPreseason: false, resetsRank: true }
    ])

    const moved = saveSeasons(db, [{ ...two[0], startsAt: JAN_2027 }])
    expect(moved).toHaveLength(1)
    expect(moved[0].startsAt).toBe(JAN_2027)
  })

  it('round-trips both flags', () => {
    const saved = saveSeasons(db, [
      { label: 'Preseason 2027', startsAt: DEC_2026, isPreseason: true, resetsRank: false }
    ])
    expect(saved[0]).toMatchObject({ isPreseason: true, resetsRank: false })
  })

  it('rolls back a list that collides on start, leaving the old one intact', () => {
    const before = listSeasons(db)
    expect(() =>
      saveSeasons(db, [
        { label: 'A', startsAt: JAN_2027, isPreseason: false, resetsRank: true },
        { label: 'B', startsAt: JAN_2027, isPreseason: false, resetsRank: true }
      ])
    ).toThrow()

    expect(listSeasons(db)).toEqual(before)
  })
})
