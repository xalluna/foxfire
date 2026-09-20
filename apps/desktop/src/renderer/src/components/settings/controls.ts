/**
 * The class strings every settings control shares.
 *
 * Before the sidebar rewrite each section pasted its own input, button and
 * checkbox classes, and they had drifted — three padding values for the same
 * ghost button, two different focus treatments. Rows are now assembled from
 * these instead, so a control looks the same wherever it lands.
 *
 * Surfaces follow the page stack: the pane is `canvas`, a card is `surface`,
 * and anything you type into sits one step lighter again on `surface-2`.
 */

export const inputClass =
  'min-w-0 rounded-md border border-hairline bg-surface-2 px-3 py-1.5 text-sm text-text outline-none transition placeholder:text-text-mute focus:border-accent-dim disabled:cursor-not-allowed disabled:opacity-50'

export const selectClass =
  'h-8 rounded-md border border-hairline bg-surface-2 px-2 text-sm text-text outline-none transition focus:border-accent-dim disabled:cursor-not-allowed disabled:opacity-50'

/** Readonly path display. Muted, because it reports rather than accepts. */
export const readonlyInputClass =
  'min-w-0 flex-1 truncate rounded-md border border-hairline bg-surface-2 px-3 py-1.5 text-2xs text-text-dim'

export const ghostButtonClass =
  'shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-hairline disabled:hover:text-text-dim'

export const primaryButtonClass =
  'shrink-0 rounded-md border border-accent-dim bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute'

export const dangerButtonClass =
  'shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-text-mute transition hover:border-red/40 hover:text-red disabled:cursor-not-allowed disabled:opacity-40'

export const checkboxClass = 'h-4 w-4 shrink-0 accent-accent disabled:cursor-not-allowed'

/** The eyebrow above a number or path that needs naming inside a block row. */
export const fieldLabelClass = 'block text-2xs font-medium uppercase tracking-widest text-text-mute'
