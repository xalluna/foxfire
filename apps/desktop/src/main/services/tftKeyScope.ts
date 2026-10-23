import type { DatabaseSync } from 'node:sqlite'

/**
 * What changes when TFT's key does.
 *
 * Riot encrypts a puuid against the key that asked for it, so every id this PC
 * holds under the old TFT key means nothing to the new one. Each is dropped
 * here and learnt again, from the account's Riot ID, by the next TFT sync that
 * needs it.
 */
export function forgetTftIdentities(db: DatabaseSync): void {
  db.prepare("DELETE FROM account_scoped_puuids WHERE scope = 'tft'").run()
}
