import clsx from 'clsx'

/**
 * The one proportion bar in the app.
 *
 * Six screens had grown their own copy of the same two nested divs, which meant
 * six chances for the track colour, the height, or the overflow clip to drift
 * apart. The differences that actually matter are the two colours, so they are
 * the only thing a caller picks.
 *
 * Labels stay at the call site: each one sits differently (above, beside, both)
 * and folding them in here would need more props than the bar has markup.
 */
export type BarTone = 'accent' | 'accent-solid' | 'taken' | 'winrate'

const TRACK: Record<BarTone, string> = {
  accent: 'bg-surface-2',
  'accent-solid': 'bg-surface-2',
  taken: 'bg-surface-2',
  // Not a neutral groove: the exposed track *is* the losses, so the bar reads
  // as a win/loss split rather than a fill against empty space.
  winrate: 'bg-red/40'
}

const FILL: Record<BarTone, string> = {
  accent: 'bg-accent/70',
  // Full-strength gold plus easing — this one reports live progress, so it is
  // meant to draw the eye and to animate between readings.
  'accent-solid': 'bg-accent transition-all duration-300',
  taken: 'bg-red/50',
  winrate: 'bg-teal'
}

export function Bar({
  fraction,
  tone = 'accent',
  className
}: {
  /** 0–1. Clamped here so no caller can overflow the track. */
  fraction: number
  tone?: BarTone
  /** Call-site layout only — margins, or `flex-1` when the bar is a flex child. */
  className?: string
}): JSX.Element {
  // NaN survives Math.min/Math.max and would reach the DOM as `width: NaN%`,
  // so it is screened out rather than clamped — a 0/0 ratio means "no data".
  const pct = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) * 100 : 0

  return (
    <div className={clsx('h-1 overflow-hidden rounded-full', TRACK[tone], className)}>
      <div className={clsx('h-full rounded-full', FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}
