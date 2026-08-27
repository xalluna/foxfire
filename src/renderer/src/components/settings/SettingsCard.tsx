import type { ReactNode } from 'react'

/**
 * A group of settings rows, drawn as one card.
 *
 * The page is the unit of navigation and the card is the unit of grouping:
 * Game capture is one page holding Recording, OBS, Which games, Quality and
 * Storage, rather than one undifferentiated scroll. `title` renders above the
 * card rather than inside it, so the card itself is nothing but rows and the
 * heading can be read as a label for the group beneath it.
 *
 * Children are separated by hairlines automatically. Anything conditional can
 * be rendered as `false` and will not leave a divider behind, because
 * `divide-y` only draws between elements that exist.
 */
export function SettingsCard({
  title,
  description,
  children
}: {
  /** Names the group. Omitted when a page has only one card to name. */
  title?: string
  /** Why the group exists, when the title cannot carry it alone. */
  description?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section>
      {(title !== undefined || description !== undefined) && (
        <div className="mb-2">
          {title !== undefined && <h2 className="font-display text-base text-text-dim">{title}</h2>}
          {description !== undefined && (
            <p className="mt-1 text-2xs leading-relaxed text-text-mute">{description}</p>
          )}
        </div>
      )}
      <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
        {children}
      </div>
    </section>
  )
}

/**
 * A settings page: heading, the paragraph explaining why the page exists, then
 * cards. Every category renders one of these, so the vertical rhythm is set
 * once instead of per section.
 */
export function SettingsPage({
  title,
  intro,
  children
}: {
  title: string
  /** Prose, not a subtitle — several sentences of why is normal here. */
  intro?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <h1 className="font-display text-xl text-text">{title}</h1>
      {intro !== undefined && (
        <p className="mt-2 text-sm leading-relaxed text-text-dim">{intro}</p>
      )}
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  )
}
