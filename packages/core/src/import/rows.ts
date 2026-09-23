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
  /**
   * Games already stored under this account's dead id that the server moved onto
   * the one that works. Absent from a server that predates re-uploading.
   */
  healedMatches?: number
}

/**
 * What the server made of one batch, in four answers rather than one.
 *
 * `skipped` is what it already had, `failed` is what it could not read and
 * `unplaced` is what it could read but had nowhere to file — a reading for an
 * account that never resolved. They are kept apart because "nothing was
 * imported" means something different for each. A server that predates
 * `unplaced` counts those as skipped.
 */
export interface ImportBatchOutcome {
  accepted: number
  skipped: number
  failed: number
  unplaced: number
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
