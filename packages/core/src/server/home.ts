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
 * Which of your accounts is home, given the one this machine remembers.
 *
 * The remembered one when it is among them. Nothing remembered falls back to
 * your first, so a freshly joined server opens somewhere rather than nowhere.
 * And a remembered account that is not yours marks none of them: a browser can
 * star a friend's profile to open on, and that friend is not in this list.
 *
 * There is no falling back past your own accounts. The desktop used to open on
 * the first account on the server at all, which needed every account on the
 * server to pick it from; somebody with nothing claimed is better told how to
 * claim something than shown a stranger's history.
 */
export function homeAmong(mine: Account[], storedId: string | null): Account | null {
  if (storedId === null) return mine[0] ?? null
  return mine.find((a) => a.id === storedId) ?? null
}

/** The same list, with `isHomeAccount` set on the one `homeAmong` picks. */
export function markHome(mine: Account[], storedId: string | null): Account[] {
  const home = homeAmong(mine, storedId)
  return mine.map((account) => ({ ...account, isHomeAccount: account.id === home?.id }))
}
