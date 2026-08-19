import clsx from 'clsx'
import type { MatchSummary } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { useRecentSummary, type ChampionForm } from '../hooks/useRecentSummary'
import { championIconUrl, championName } from '../lib/assets'
import { positionIcon, positionLabel } from '../lib/positions'
import { formatPercent } from '../lib/matchStats'
import { Asset } from './Asset'
import { Bar } from './Bar'

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

function ChampionRow({ champ }: { champ: ChampionForm }): JSX.Element {
  const assets = useAssets()
  const winRate = champ.games > 0 ? champ.wins / champ.games : 0
  const kda =
    champ.deaths === 0 ? 'Perfect' : ((champ.kills + champ.assists) / champ.deaths).toFixed(2)

  return (
    <div className="flex items-center gap-2">
      <Asset
        src={assets ? championIconUrl(assets, champ.championId) : null}
        className="h-7 w-7"
        rounded="rounded-full"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-dim">
          {assets ? championName(assets, champ.championId) : ''}
        </p>
        <p className="text-2xs tabular-nums text-text-mute">
          {kda}
          {champ.deaths > 0 && ':1'} KDA
        </p>
      </div>
      <div className="text-right">
        <p
          className={clsx(
            'text-sm tabular-nums',
            winRate >= 0.6 ? 'text-teal' : winRate >= 0.5 ? 'text-text' : 'text-text-dim'
          )}
        >
          {Math.round(winRate * 100)}%
        </p>
        <p className="text-2xs tabular-nums text-text-mute">
          {champ.wins}W {champ.games - champ.wins}L
        </p>
      </div>
    </div>
  )
}

/**
 * Recent-form block above the match list.
 *
 * Every figure is an aggregate of measured stats over the same rows shown
 * below — no rating, no estimate. Answers "how have I been playing lately",
 * which the season-long rank cards in the rail can't.
 */
export function RecentSummary({ matches }: { matches: MatchSummary[] | undefined }): JSX.Element | null {
  const summary = useRecentSummary(matches)
  if (!summary) return null

  return (
    <section className="rounded-lg border border-hairline bg-surface/60 p-4">
      <p className="mb-3 text-2xs font-medium uppercase tracking-widest text-text-mute">
        Last {summary.games} games
      </p>

      <div className="flex gap-5">
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

        <div className="w-px shrink-0 bg-hairline" />

        {/* Most played */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {summary.topChampions.map((champ) => (
            <ChampionRow key={champ.championId} champ={champ} />
          ))}
        </div>

        <div className="w-px shrink-0 bg-hairline" />

        {/* Role split */}
        <div className="w-[132px] shrink-0 space-y-1.5">
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
