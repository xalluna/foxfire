import clsx from 'clsx'
import type { LeagueEntry } from '@foxfire/core'
import { tierColor, tierProgress } from '../lib/rank'

/**
 * How far through the tier: its four divisions, then the crest they lead to.
 *
 * The divisions behind are filled, the current one ringed, and a marker sits
 * where the LP puts it between that division and the next. Nothing for the
 * apex tiers — past Diamond there are no divisions to walk and no fixed LP to
 * the next tier — or for anybody unranked.
 */
export function TierProgressTrack({
  entry
}: {
  entry: Pick<LeagueEntry, 'tier' | 'rank' | 'leaguePoints'>
}): JSX.Element | null {
  const progress = tierProgress(entry)
  if (!progress) return null

  const color = tierColor(entry.tier)
  const percent = `${progress.fraction * 100}%`
  const last = progress.stops.length - 1
  const at = (i: number): string => `${(i / last) * 100}%`

  return (
    <div className="px-1.5 pb-0.5 pt-2" aria-label="Progress to the next tier">
      <div className="relative h-3">
        {/* The rail, then what has been covered of it. */}
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-hairline" />
        <div
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full"
          style={{ width: percent, backgroundColor: color }}
        />

        {progress.stops.map((stop, i) => {
          const passed = i < progress.current
          const current = i === progress.current
          // The next tier's crest colour, so the far end says where it leads.
          const ring = passed || current ? color : i === last ? tierColor(stop.tier) : undefined
          return (
            <span
              key={stop.label}
              className={clsx(
                'absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                !passed && !current && 'bg-canvas'
              )}
              style={{
                left: at(i),
                borderColor: ring ?? 'rgb(var(--hairline))',
                backgroundColor: passed ? color : current ? 'rgb(var(--canvas))' : undefined
              }}
            />
          )
        })}

        {/* Where the LP puts them, pointing down at the rail. */}
        <span
          className="absolute -top-1.5 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[5px] border-x-transparent"
          style={{ left: percent, borderTopColor: color }}
        />
      </div>

      <div className="relative mt-1 h-3">
        {progress.stops.map((stop, i) => (
          <span
            key={stop.label}
            className={clsx(
              'absolute -translate-x-1/2 text-2xs tabular-nums',
              i === progress.current ? 'font-medium' : 'text-text-mute'
            )}
            style={{
              left: at(i),
              color: i === progress.current ? color : i === last ? tierColor(stop.tier) : undefined
            }}
          >
            {stop.label}
          </span>
        ))}
      </div>
    </div>
  )
}
