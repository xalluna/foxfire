import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * The shared shell for every "nothing here" screen. A personal Riot key
 * expires daily, so no-key, expired-key and no-data states are part of normal
 * use rather than edge cases, and they all get the same considered treatment.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral'
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'warning' | 'error'
}): JSX.Element {
  const toneRing = {
    neutral: 'border-hairline text-text-mute',
    warning: 'border-amber/40 text-amber',
    error: 'border-red/40 text-red'
  }[tone]

  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        className={clsx(
          'mb-4 flex h-12 w-12 items-center justify-center rounded-full border',
          toneRing
        )}
      >
        {icon}
      </div>
      <p className="font-display text-lg text-text">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-dim">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
