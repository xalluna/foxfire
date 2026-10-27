import { useMemo } from 'react'
import type { TftMatchSummary } from '@foxfire/core'
import { useAssetManifest } from '../../context/assetManifest'
import { formatPercent } from '../../lib/matchStats'
import { tftAsset, tftName } from '../../lib/tft'
import { summariseTftRecent } from '../../lib/tftRecent'
import { PlacementCell } from './TftBoard'

/** The top-half ring, as League's win-rate ring draws a record. */
function TopRing({ rate }: { rate: number }): JSX.Element {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const good = rate >= 0.5

  return (
    <div className="relative h-[74px] w-[74px] shrink-0">
      <svg viewBox="0 0 74 74" className="h-full w-full -rotate-90">
        <circle cx="37" cy="37" r={radius} fill="none" strokeWidth="7" className="stroke-surface-2" />
        <circle
          cx="37"
          cy="37"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className={good ? 'stroke-teal' : 'stroke-accent'}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - rate)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={good ? 'text-lg font-semibold tabular-nums text-teal' : 'text-lg font-semibold tabular-nums'}>
          {formatPercent(rate)}
        </span>
      </div>
    </div>
  )
}

/**
 * The recent stretch above the TFT history: how often it made the top half,
 * where it finished on average, each finish as a coloured square newest first,
 * and the traits it kept playing — op.gg's three blocks, over the rows already
 * loaded below.
 */
export function TftRecentSummary({ matches }: { matches: TftMatchSummary[] | undefined }): JSX.Element | null {
  const manifest = useAssetManifest()
  const summary = useMemo(() => summariseTftRecent(matches), [matches])
  if (!summary) return null

  return (
    <section className="rounded-lg border border-hairline bg-surface/60 p-4">
      <p className="mb-3 text-2xs font-medium uppercase tracking-widest text-text-mute">Last {summary.games} games</p>

      <div className="flex gap-5 max-md:flex-col max-md:gap-4">
        <div className="flex shrink-0 items-center gap-3">
          <TopRing rate={summary.topRate} />
          <div>
            <p className="text-2xs text-text-mute">Top 4 rate</p>
            <p className="text-xl font-semibold leading-tight tabular-nums text-text">
              {summary.firsts} <span className="text-sm font-normal text-text-dim">1st</span>
            </p>
            <p className="mt-1 text-sm tabular-nums text-text-dim">
              Avg <span className="text-text">{summary.averagePlacement.toFixed(2)}</span> / 8
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-1 md:border-l md:border-hairline md:pl-5">
          <p className="mb-1.5 text-2xs text-text-mute">Standing</p>
          <div className="flex flex-wrap gap-1">
            {summary.finishes.map((finish) => (
              <PlacementCell key={finish.matchId} placement={finish.placement} top={finish.top} />
            ))}
          </div>
        </div>

        {summary.synergies.length > 0 && (
          <div className="shrink-0 md:w-56 md:border-l md:border-hairline md:pl-5">
            <p className="mb-1.5 text-2xs text-text-mute">Synergies</p>
            <ul className="space-y-1.5">
              {summary.synergies.map((synergy) => {
                const icon = tftAsset(manifest, 'traits', synergy.name)?.image ?? null
                return (
                  <li key={synergy.name} className="flex items-center gap-2 text-sm">
                    {icon ? (
                      <img src={icon} alt="" className="h-4 w-4 object-contain" />
                    ) : (
                      <span className="h-4 w-4 rounded-sm bg-surface-2" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{tftName(manifest, 'traits', synergy.name)}</span>
                    <span className="text-2xs tabular-nums text-text-dim">{synergy.games}</span>
                    <span className="w-10 text-right text-2xs tabular-nums text-text-mute">
                      #{synergy.averagePlacement.toFixed(2)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
