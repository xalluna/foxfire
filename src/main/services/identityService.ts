import { getDb } from '../db'
import { getAccountById, listAccounts, rekeyAccountPuuid } from '../db/repositories/accounts.repo'
import { isNotFound } from '../riot/client'
import { getAccountByRiotId } from '../riot/endpoints/account'
import type { RegionalRoute } from '../riot/regions'
import { createLogger } from '../telemetry/logger'
import type { IdentityOutcome, IdentityReport } from '@shared/types'

/**
 * Repairing an account after its API key changed.
 *
 * Riot encrypts a puuid against the key that asked for it, so a new key — a
 * personal one replaced after its 24 hours, or an application key finally
 * approved — turns every stored puuid into a value Riot answers with 400
 * "Exception decrypting". Nothing is lost when that happens; the account simply
 * has to be introduced again.
 *
 * The Riot ID is what makes that possible. It is the only handle this app holds
 * that Riot does not encrypt, which is why accounts are matched on it against
 * the League client too (see accounts.repo's getAccountByRiotId), and it is the
 * one thing a key change cannot invalidate.
 */

const log = createLogger('identity')

/**
 * Re-resolves one account and, if the puuid moved, rewrites its history onto
 * the new one.
 *
 * A rename is reported rather than guessed at: the account keeps its history
 * and its old puuid, and the user re-adds it under the name they now play
 * under. Deleting rows because a lookup missed would be a poor trade for a
 * problem a single Riot ID edit solves.
 *
 * Anything else — a rejected key, a rate limit, a network failure — throws.
 * Those are not "this account is broken", and treating them as such would
 * retire a perfectly good puuid on the strength of a timeout.
 */
export async function repairAccountIdentity(accountId: number): Promise<IdentityOutcome> {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)

  let resolved
  try {
    resolved = await getAccountByRiotId(
      account.regionalRoute as RegionalRoute,
      account.gameName,
      account.tagLine
    )
  } catch (err) {
    if (isNotFound(err)) {
      log.info('Riot no longer knows this Riot ID', {
        accountId,
        riotId: `${account.gameName}#${account.tagLine}`
      })
      return 'unresolved'
    }
    throw err
  }

  if (resolved.puuid === account.puuid) return 'unchanged'

  const moved = rekeyAccountPuuid(db, accountId, account.puuid, resolved.puuid)
  log.info('Re-linked an account after an API key change', {
    accountId,
    matches: moved.matches,
    participants: moved.participants
  })
  return 'repaired'
}

/**
 * Every account, one report each. Used when a new key is saved, which is the
 * moment the app knows a rotation happened rather than inferring it from a
 * failure.
 *
 * One account's failure never stops the rest: they are independent lookups, and
 * a key that works for one works for all, so a single failure says something
 * about that account rather than about the run.
 */
export async function repairAllIdentities(): Promise<IdentityReport[]> {
  const reports: IdentityReport[] = []

  for (const account of listAccounts(getDb())) {
    const riotId = `${account.gameName}#${account.tagLine}`
    try {
      reports.push({ accountId: account.id, riotId, outcome: await repairAccountIdentity(account.id) })
    } catch (err) {
      log.error('Could not re-resolve an account', err, { accountId: account.id })
      reports.push({ accountId: account.id, riotId, outcome: 'failed' })
    }
  }

  return reports
}

/** How many accounts the run actually moved onto a new puuid. */
export function countRepaired(reports: IdentityReport[]): number {
  return reports.filter((report) => report.outcome === 'repaired').length
}
