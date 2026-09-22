import type { Account } from '../types'

/**
 * Which account opens first, remembered by whoever is asking.
 *
 * A server does not answer this and should not: it is a preference belonging to
 * one PC or one browser, and a server that held it would be holding one answer
 * for everybody signed in to it.
 */
export interface HomeAccountStore {
  get(): string | null
  set(accountId: string): void
}

/**
 * Stamps a remembered home onto a server's account list.
 *
 * Falls back to the first account the caller owns, so a freshly joined server
 * opens somewhere rather than nowhere. Past that the two clients differ, and
 * `fallbackToAny` is the difference: the desktop opens on the first account at
 * all, because on a shared server there is always somebody's history to look
 * at, while the web client would rather open on its list of players than on a
 * stranger's profile.
 */
export function applyHomeAccount(
  accounts: Account[],
  storedId: string | null,
  options: { fallbackToAny: boolean } = { fallbackToAny: true }
): Account[] {
  if (accounts.length === 0) return accounts

  const home =
    accounts.find((a) => a.id === storedId) ??
    accounts.find((a) => a.isMine) ??
    (options.fallbackToAny ? accounts[0] : undefined)

  return accounts.map((account) => ({ ...account, isHomeAccount: account.id === home?.id }))
}
