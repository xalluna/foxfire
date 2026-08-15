import clsx from 'clsx'

/**
 * Loading placeholder. Callers pass the geometry of the real thing so the
 * layout doesn't jump when data arrives — this app is queried constantly
 * (a personal Riot key expires every 24h) so loading is a common state, not
 * a rare one.
 */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded bg-surface-2',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer',
        'after:bg-gradient-to-r after:from-transparent after:via-gold/[0.07] after:to-transparent',
        className
      )}
    />
  )
}

/** Mirrors the 72px collapsed MatchListRow so the list keeps its rhythm while loading. */
export function MatchRowSkeleton(): JSX.Element {
  return (
    <div className="flex h-[72px] items-center gap-3 border-l-[3px] border-hairline px-3">
      <Skeleton className="h-10 w-10 rounded-md" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-16" />
      </div>
      <div className="ml-6 space-y-1.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-2.5 w-14" />
      </div>
      <div className="ml-auto flex gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-5" />
        ))}
      </div>
    </div>
  )
}

export function MatchListSkeleton({ rows = 7 }: { rows?: number }): JSX.Element {
  return (
    <div className="divide-y divide-hairline/60" aria-busy aria-label="Loading matches">
      {Array.from({ length: rows }, (_, i) => (
        <MatchRowSkeleton key={i} />
      ))}
    </div>
  )
}
