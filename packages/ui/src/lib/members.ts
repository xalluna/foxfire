/**
 * What the members list says about its own length.
 *
 * The count is the server's — the whole list, or everybody matching what was
 * typed — rather than the rows on screen, because the rows are a page of it. So
 * "120 members" when nothing is typed, and "3 matching" while searching: the
 * old "3 of 120" needs both numbers at once, and a page only carries one.
 */
export function memberCountLabel(total: number, query: string): string {
  if ((query ?? '').trim()) return `${total} matching`
  return `${total} ${total === 1 ? 'member' : 'members'}`
}
