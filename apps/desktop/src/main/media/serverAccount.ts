import type { Account } from '@foxfire/core'

/**
 * The account on the server a recording belongs to: its own id, or failing
 * that its Riot ID.
 *
 * A recording made in local-only mode, or on another server, carries an
 * account id that means nothing here, and the Riot ID is what still names the
 * player. Only an account the server says is yours takes an upload — the
 * server refuses anybody else's anyway — so that is all this answers with.
 */
export function serverAccountFor(
  recording: { accountId: string; riotId: string | null },
  accounts: readonly Account[]
): Account | null {
  const mine = accounts.filter((account) => account.isMine === true)
  const byId = mine.find((account) => account.id === recording.accountId)
  if (byId) return byId

  const riotId = recording.riotId?.toLowerCase()
  if (!riotId) return null
  return mine.find((account) => `${account.gameName}#${account.tagLine}`.toLowerCase() === riotId) ?? null
}
