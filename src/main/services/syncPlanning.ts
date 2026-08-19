// Pure sync-planning logic: decides *what* to fetch. Deliberately free of any
// database or network imports so it stays trivially testable.

import type { IdentityOutcome } from '@shared/types'

/**
 * Given Riot's newest-first match ID list and the last ID we stored, returns
 * only the IDs newer than it. A missing marker means our stored history is
 * older than this whole page, so everything in it is new to us.
 */
export function selectNewMatchIds(
  allIds: readonly string[],
  mostRecentMatchId: string | null
): string[] {
  if (!mostRecentMatchId) return [...allIds]
  const knownIndex = allIds.indexOf(mostRecentMatchId)
  return knownIndex === -1 ? [...allIds] : allIds.slice(0, knownIndex)
}

/** Page sizes for a backfill run, respecting Riot's 100-per-request maximum. */
export function planMatchIdPages(target: number, pageSize: number): number[] {
  const pages: number[] = []
  let remaining = target
  while (remaining > 0) {
    const count = Math.min(pageSize, remaining)
    pages.push(count)
    remaining -= count
  }
  return pages
}

/**
 * What a sync should do once Riot has rejected its puuid as undecryptable and
 * the account has been re-resolved.
 *
 * Only a puuid that actually changed earns a retry. The other three outcomes
 * all mean the same request would fail the same way a second time, and each has
 * its own thing to tell the user — a rename needs their hands, a rejected key
 * needs a new key, and a puuid Riot both rejects and reissues unchanged is a
 * genuinely strange state that should be reported rather than papered over with
 * a retry loop.
 */
export function afterIdentityRepair(
  outcome: IdentityOutcome,
  riotId: string
): { retry: true } | { retry: false; message: string } {
  switch (outcome) {
    case 'repaired':
      return { retry: true }
    case 'unresolved':
      return {
        retry: false,
        message: `Riot no longer knows ${riotId} — if you renamed the account, remove it and add it under the new Riot ID.`
      }
    case 'failed':
      return { retry: false, message: `Could not reach Riot to re-link ${riotId}. Try syncing again.` }
    case 'unchanged':
      return {
        retry: false,
        message: `Riot rejected the stored ID for ${riotId} but hands back the same one. Try a fresh API key.`
      }
  }
}
