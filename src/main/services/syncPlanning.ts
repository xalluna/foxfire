// Pure sync-planning logic: decides *what* to fetch. Deliberately free of any
// database or network imports so it stays trivially testable.

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
