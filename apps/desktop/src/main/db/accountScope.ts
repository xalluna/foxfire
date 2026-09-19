/**
 * How a machine-local row says whose account it is.
 *
 * Deliberately free of every import. The repositories take this, and they are
 * the one part of the main process that can be tested against an in-memory
 * database — reaching for the API layer from here would pull Electron in behind
 * it and cost that. Resolving a context is src/main/api/accountContext.ts's
 * job; describing one is this.
 */

/** Whose rows, as both the current id and the name that outlives it. */
export interface AccountContext {
  /**
   * Opaque. This machine's rowid as text in local-only mode, and a Foxfire
   * Server's own id — a GUID — when connected to one.
   */
  accountId: string

  /**
   * `gameName#tagLine`, and the reason the id alone is not enough.
   *
   * An id from one server means nothing on another and nothing at all locally,
   * so a row keyed only on it is orphaned the moment somebody joins a
   * community, leaves one, or moves between two. This is the identity that
   * means the same thing everywhere: it is what the League client reports, what
   * a server files accounts under, and what a player would type.
   *
   * Null is a real answer — an id for an account since deleted, or from a
   * server this machine is no longer on. The row is still written and still
   * findable by its id.
   */
  riotId: string | null

  /**
   * The active server's URL, or null for local-only.
   *
   * Recorded so a row remembers where its id came from. Not used to filter
   * reads: the files are on this disk and belong to whoever is sitting at it,
   * not to whoever happened to be hosting when the game was played.
   */
  serverKey: string | null
}

/**
 * The predicate that claims a row for an account, as SQL.
 *
 * Either handle matches. A recording made in local-only mode carries `1`; the
 * same player on a server carries a GUID; both carry `Faker#NA1`, so both come
 * back after the move that changed the id.
 */
export function ownedBy(idColumn: string, riotColumn: string): string {
  return `(${idColumn} = ? OR (? IS NOT NULL AND ${riotColumn} = ?))`
}

/** The three bind parameters <see cref="ownedBy"/> expects, in order. */
export function ownedByParams(account: AccountContext): [string, string | null, string | null] {
  return [account.accountId, account.riotId, account.riotId]
}
