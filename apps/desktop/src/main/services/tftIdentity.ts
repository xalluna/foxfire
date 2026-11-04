import type { DatabaseSync } from 'node:sqlite'
import type { GameId } from '@foxfire/core'
import { rekeyTftBoards } from '../db/repositories/tftMatches.repo'
import { hasTftApiKey } from '../riot/client'
import { getTftAccountByRiotId } from '../riot/endpoints/tftLeague'
import type { RegionalRoute } from '../riot/regions'
import type { StoredAccount } from '../db/repositories/accounts.repo'
import { createLogger } from '../telemetry/logger'

const log = createLogger('tftIdentity')

/*
 * Which id an account's TFT is filed under.
 *
 * Riot encrypts a puuid against the key that asked for it. While TFT shares the
 * main key that is the account's own puuid, and nothing here is needed. With a
 * TFT key of its own, TFT's endpoints only know the player by the id that key
 * was given, which is learnt from the Riot ID the first time TFT is synced and
 * kept in account_scoped_puuids.
 *
 * A board is always filed under the id that fetched it, so every change of key
 * moves the account's boards with it: onto the account's own puuid when a TFT
 * key is taken away or replaced, and from there onto the new key's id the next
 * time TFT is synced. In between they are where every read looks for them.
 */

function storedTftPuuid(db: DatabaseSync, accountId: number): string | null {
  const row = db
    .prepare("SELECT puuid FROM account_scoped_puuids WHERE account_id = ? AND scope = 'tft'")
    .get(accountId) as unknown as { puuid: string } | undefined
  return row?.puuid ?? null
}

/** The id this account's TFT boards are under right now, without asking Riot anything. */
export function tftPuuidOf(db: DatabaseSync, account: Pick<StoredAccount, 'id' | 'puuid'>): string {
  return (hasTftApiKey() ? storedTftPuuid(db, account.id) : null) ?? account.puuid
}

/** The id one game files this account's games under: League's own, or TFT's. */
export function puuidForGame(db: DatabaseSync, account: Pick<StoredAccount, 'id' | 'puuid'>, game: GameId): string {
  return game === 'tft' ? tftPuuidOf(db, account) : account.puuid
}

/**
 * The id TFT's endpoints know this account by, learning it if it has to.
 *
 * One Riot call, the first time TFT is synced under a key of its own; the
 * account's boards move onto the id it answers with in the same transaction
 * that records it.
 */
export async function resolveTftPuuid(db: DatabaseSync, account: StoredAccount): Promise<string> {
  if (!hasTftApiKey()) return account.puuid

  const stored = storedTftPuuid(db, account.id)
  if (stored) return stored

  const riot = await getTftAccountByRiotId(account.regionalRoute as RegionalRoute, account.gameName, account.tagLine)

  db.exec('BEGIN')
  try {
    db.prepare(
      "INSERT OR REPLACE INTO account_scoped_puuids (account_id, scope, puuid) VALUES (?, 'tft', ?)"
    ).run(account.id, riot.puuid)
    const moved = rekeyTftBoards(db, account.puuid, riot.puuid)
    db.exec('COMMIT')
    log.info('Learnt an account’s TFT id', { accountId: account.id, boardsMoved: moved })
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return riot.puuid
}

/**
 * Forgets one account's TFT id, moving its boards back onto its own puuid —
 * for an id Riot no longer recognises, before learning it again.
 */
export function forgetTftIdentity(db: DatabaseSync, account: Pick<StoredAccount, 'id' | 'puuid'>): void {
  const stored = storedTftPuuid(db, account.id)
  if (stored === null) return

  db.exec('BEGIN')
  try {
    rekeyTftBoards(db, stored, account.puuid)
    db.prepare("DELETE FROM account_scoped_puuids WHERE account_id = ? AND scope = 'tft'").run(account.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** The same for every account, when TFT's key is added, replaced or taken away. */
export function forgetTftIdentities(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT a.id, a.puuid
         FROM account_scoped_puuids s
         JOIN accounts a ON a.id = s.account_id
        WHERE s.scope = 'tft'`
    )
    .all() as unknown as Array<{ id: number; puuid: string }>

  for (const account of rows) forgetTftIdentity(db, account)
}
