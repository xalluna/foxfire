import { serverBacked } from '.'
import { getServerState } from '../services/serverService'
import type { AccountContext } from '../db/accountScope'

export type { AccountContext } from '../db/accountScope'

/**
 * The context for one account, as it stands right now.
 *
 * Asks whichever store owns accounts rather than SQLite, so it answers in both
 * modes — in local-only that is this machine's own accounts table, and
 * connected it is one lookup on the server.
 *
 * A null `riotId` is a real answer rather than a failure: an id for an account
 * that has since been deleted, or one from a server this machine is no longer
 * on. The row is still written, and still findable by the id.
 */
export async function accountContext(
  accountId: string
): Promise<AccountContext & { platformId?: string | null }> {
  const serverKey = getServerState().activeUrl

  try {
    const account = await serverBacked().accounts.get(accountId)

    return {
      accountId,
      riotId: account ? `${account.gameName}#${account.tagLine}` : null,
      serverKey,
      // The platform half of the account's match ids — NA1 of NA1_5312345678 —
      // which with the client's game id names a match before any sync has it.
      platformId: account?.platform ? account.platform.toUpperCase() : null
    }
  } catch {
    // A server that cannot be reached must not stop a recording from being
    // written down. The id and the server are both known without asking
    // anybody; only the durable name is lost, and a later pass can fill it in.
    return { accountId, riotId: null, serverKey }
  }
}
