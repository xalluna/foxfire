import clsx from 'clsx'
import type { MatchSummary } from '@foxfire/core'
import { useRecentSummary } from '../hooks/useRecentSummary'
import { positionIcon, positionLabel } from '../lib/positions'
import { formatPercent } from '../lib/matchStats'
import { Bar } from './Bar'
import { ChampionRecordRow } from './ChampionRecordRow'

/** Win-rate ring. An SVG arc rather than a chart library — one number, one shape. */
function WinRateRing({ winRate }: { winRate: number | null }): JSX.Element {
  const pct = winRate ?? 0
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const good = pct >= 0.5

  return (
    <div className="relative h-[74px] w-[74px] shrink-0">
      <svg viewBox="0 0 74 74" className="h-full w-full -rotate-90">
        <circle cx="37" cy="37" r={radius} fill="none" strokeWidth="7" className="stroke-red/50" />
        <circle
          cx="37"
          cy="37"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className={good ? 'stroke-teal' : 'stroke-accent'}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={clsx(
            'font-display text-lg leading-none tabular-nums',
            good ? 'text-teal' : 'text-text'
          )}
        >
          {formatPercent(winRate)}
        </span>
      </div>
    </div>
  )
}

/**
 * Recent-form block above the match list.
 *
 * Every figure is an aggregate of measured stats over the same rows shown
 * below — no rating, no estimate. Answers "how have I been playing lately",
 * which the season-long cards in the rail can't.
 *
 * Its most-played champions can be the rail's too, with different numbers:
 * these are the last few games, those are the season. The heading says which
 * window this is, and the rail's card says which season it is.
 */
export function RecentSummary({ matches }: { matches: MatchSummary[] | undefined }): JSX.Element | null {
  const summary = useRecentSummary(matches)
  if (!summary) return null

  return (
    <section className="rounded-lg border border-hairline bg-surface/60 p-4">
      <p className="mb-3 text-2xs font-medium uppercase tracking-widest text-text-mute">
        Last {summary.games} games
      </p>

      {/* Three blocks side by side, stacked on a phone with the dividers dropped. */}
      <div className="flex gap-5 max-md:flex-col max-md:gap-4">
        {/* Record */}
        <div className="flex shrink-0 items-center gap-3">
          <WinRateRing winRate={summary.winRate} />
          <div>
            <p className="font-display text-xl leading-tight text-text">
              {summary.wins}W <span className="text-text-mute">·</span> {summary.losses}L
            </p>
            <p className="mt-1 text-sm tabular-nums text-text-dim">
              {summary.avgKills.toFixed(1)}
              <span className="text-text-mute"> / </span>
              <span className="text-red">{summary.avgDeaths.toFixed(1)}</span>
              <span className="text-text-mute"> / </span>
              {summary.avgAssists.toFixed(1)}
            </p>
            <p className="text-2xs tabular-nums text-text-mute">
              {summary.kdaRatio === null ? 'Perfect' : `${summary.kdaRatio.toFixed(2)}:1`} KDA ·
              P/Kill {formatPercent(summary.killParticipation)}
            </p>
          </div>
        </div>

        <div className="w-px shrink-0 bg-hairline max-md:hidden" />

        {/* Most played */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {summary.topChampions.map((champ) => (
            <ChampionRecordRow key={champ.championId} champ={champ} />
          ))}
        </div>

        <div className="w-px shrink-0 bg-hairline max-md:hidden" />

        {/* Role split */}
        <div className="w-[132px] shrink-0 space-y-1.5 max-md:w-full">
          {summary.roles.length === 0 ? (
            <p className="text-2xs text-text-mute">No ranked positions in this window.</p>
          ) : (
            summary.roles.map((role) => (
              <div key={role.position} className="flex items-center gap-2">
                <img src={positionIcon(role.position)!} alt="" className="h-4 w-4 shrink-0" />
                <span className="w-12 shrink-0 text-2xs text-text-dim">
                  {positionLabel(role.position)}
                </span>
                <Bar fraction={role.share} className="flex-1" />
                <span className="w-7 shrink-0 text-right text-2xs tabular-nums text-text-mute">
                  {Math.round(role.share * 100)}%
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
