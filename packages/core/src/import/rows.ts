/**
 * The rows an old stats.db is sent to a server as.
 *
 * Shared between the importer that builds them and the server API that posts
 * them, so the two cannot disagree about a field name — which on this path
 * would be a year of somebody's history arriving with a blank where it matters.
 */

/** An account, named by the Riot ID the server re-resolves it from. */
export interface ImportAccountRow {
  gameName: string
  tagLine: string
  platform: string | null
  /** Dead on arrival — encrypted against somebody's own key — but what the server records a translation for. */
  puuid: string
}

/** What the server made of one account. */
export interface ImportAccountResult {
  riotId: string
  accountId: string | null
  resolved: boolean
  message: string | null
}

export interface ImportSeasonRow {
  label: string
  startsAt: number
  isPreseason: boolean
  resetsRank: boolean
}

/** A match as the payload it already is: the server knows how to turn one into rows. */
export interface ImportMatchRow {
  matchId: string
  rawJson: string
}

/** A rank reading, keyed on the old puuid rather than on an id nothing else understands. */
export interface ImportReadingRow {
  puuid: string
  queueType: string
  tier: string | null
  division: string | null
  leaguePoints: number | null
  wins: number | null
  losses: number | null
  source: string
  capturedAt: number
  matchId: string | null
}
