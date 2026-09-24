/**
 * The keyboard arithmetic of the player search box, apart from the markup so it
 * can be tested without a DOM.
 */

/**
 * The row to highlight after an arrow key, over `count` rows.
 *
 * Nothing highlighted goes to the first row on the way down and the last on
 * the way up, and either end wraps round to the other — a list of ten is
 * quicker to leave the long way than to walk back up.
 */
export function moveHighlight(index: number | null, delta: 1 | -1, count: number): number | null {
  if (count === 0) return null
  if (index === null) return delta === 1 ? 0 : count - 1
  return (((index + delta) % count) + count) % count
}

/**
 * Ctrl+K, or ⌘K on a Mac: the search box from anywhere.
 *
 * With nothing else held. Ctrl+Shift+K and Ctrl+Alt+K belong to other things —
 * a browser's own devtools among them — and taking them would be a surprise.
 */
export function isSearchShortcut(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k'
}
