import { validateLpEditorSearch, type LpEditorSearch } from '@foxfire/screens'

/**
 * The LP editor window's address: which account and ladder it edits, and the
 * game it was opened on — `/lp-editor?account=…&queue=solo&match=…`.
 *
 * Its own module so the route table can validate the address without pulling
 * in the window itself, which it loads lazily.
 */
export interface LpEditorWindowSearch extends LpEditorSearch {
  /** An account id, as the main process knows accounts; it has no slugs. */
  account?: string
}

export function validateLpEditorWindowSearch(raw: Record<string, unknown>): LpEditorWindowSearch {
  const search: LpEditorWindowSearch = validateLpEditorSearch(raw)
  // An id that looks like a number arrives as one; it is text either way.
  const account = typeof raw.account === 'number' ? String(raw.account) : raw.account
  if (typeof account === 'string' && account.length > 0) search.account = account
  return search
}
