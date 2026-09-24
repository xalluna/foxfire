/**
 * The full-width "More" that closes a card in the profile's rail, leading to
 * the page the card is a summary of.
 *
 * A class rather than a component because the link itself is a router link,
 * and this package has no router: the screens build the link and dress it in
 * this, so both cards' footers look the same whichever app draws them. The
 * look is ShowMoreButton's, which closes a list the same way.
 */
export const cardFooterLinkClass =
  'flex w-full items-center justify-center gap-1 border-t border-hairline py-2 text-sm text-text-dim transition hover:bg-surface-2 hover:text-accent'
