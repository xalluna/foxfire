/**
 * How the finder matches and orders players, which a server applies in SQL and
 * the desktop's local-only search and the dev harness apply here.
 *
 * A match is the text anywhere in the name, the tag or the whole Riot ID, in
 * any capitalisation. The order is closest first, because a search box shows
 * the first ten and "ali" should find Ali#NA1 before a page of names that only
 * contain it: an exact name or Riot ID, then names that start with the text,
 * then the rest — alphabetical within each. Blank matches everybody, in name
 * order.
 */

interface Named {
  gameName: string
  tagLine: string
}

/** 0 exact, 1 the name starts with it, 2 anywhere else; null for no match at all. */
export type SearchRank = 0 | 1 | 2

/** The text a query is matched as: trimmed and lower-cased, as the server does. */
export function searchNeedle(query: string): string {
  return query.trim().toLowerCase()
}

export function searchRank(player: Named, query: string): SearchRank | null {
  const needle = searchNeedle(query)
  const name = player.gameName.toLowerCase()
  const riotId = `${name}#${player.tagLine.toLowerCase()}`

  if (needle.length === 0) return 2
  if (name === needle || riotId === needle) return 0
  if (name.startsWith(needle)) return 1
  if (riotId.includes(needle)) return 2
  return null
}

/** Closest first, then by name and tag — the order a server answers a search in. */
export function compareSearchResults(query: string): (a: Named, b: Named) => number {
  return (a, b) =>
    (searchRank(a, query) ?? 3) - (searchRank(b, query) ?? 3) ||
    compareText(a.gameName, b.gameName) ||
    compareText(a.tagLine, b.tagLine)
}

function compareText(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}
