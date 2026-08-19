import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import * as Icon from './icons'

/**
 * One foldable block on the Settings page.
 *
 * Every section here is long, and all of them together are far longer than a
 * window — the Riot key alone is the only one most people touch more than once.
 * Folded is the default so the page is a list of what exists rather than a
 * scroll through everything at once.
 *
 * Folding hides controls, which makes it easy to lose track of state you can no
 * longer see. `summary` is the answer: the one fact worth knowing while closed —
 * whether a key is saved, whether recording is on — rendered beside the chevron
 * so the collapsed page still reports rather than merely listing. Sections with
 * something wrong or unsaved colour it themselves.
 *
 * `blurb` replaces the section's full introduction while closed, so a fold is
 * still self-explanatory to someone who has never opened it.
 */
export function SettingsSection({
  icon,
  title,
  summary,
  blurb,
  defaultOpen = false,
  children
}: {
  /** Optional: About carries none, and a placeholder would only misalign it. */
  icon?: ReactNode
  title: string
  /** The one fact worth seeing while folded. Callers colour their own. */
  summary?: ReactNode
  /** One line standing in for the full introduction while folded. */
  blurb?: string
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="rounded-lg border border-hairline bg-surface p-5">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {icon}
        <h2 className="font-display text-lg text-text">{title}</h2>
        <span className="ml-auto flex items-center gap-2.5">
          {summary}
          <Icon.ChevronDown
            className={clsx('shrink-0 text-text-mute transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>

      {!open && blurb && <p className="mt-2 text-sm leading-relaxed text-text-dim">{blurb}</p>}

      {open && children}
    </section>
  )
}

/** The muted default for a section summary, so they line up without repetition. */
export function SectionSummary({
  children,
  tone = 'mute'
}: {
  children: ReactNode
  tone?: 'mute' | 'warn' | 'good'
}): JSX.Element {
  return (
    <span
      className={clsx(
        'text-2xs',
        tone === 'warn' ? 'text-amber' : tone === 'good' ? 'text-teal' : 'text-text-mute'
      )}
    >
      {children}
    </span>
  )
}
