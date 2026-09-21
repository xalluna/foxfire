import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Account, ChampionStats, RankRange } from '@shared/types'
import { queueFilterLabel, parseSeasonRange, seasonRange } from '@foxfire/core'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName } from '../lib/assets'
import { formatPercent, kdaRatio, perMinute } from '../lib/matchStats'
import { Asset } from '../components/Asset'
import { Bar } from '../components/Bar'
import { EmptyState } from '../components/EmptyState'
import { QueueFilter } from '../components/QueueFilter'
import { Segmented } from '../components/Segmented'
import { Skeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'
import { useUiStore } from '../store/uiStore'

type SortKey = 'games' | 'winRate' | 'kda' | 'damage' | 'cs'
type SortDir = 'asc' | 'desc'

/**
 * Below this, the derived columns are dimmed rather than hidden.
 *
 * A 100% win rate and a 4.00:1 KDA off one game are true and meaningless, and
 * they sit next to forty-game numbers that took real evidence to earn. Hiding
 * the rows would lose the champions you are currently trying out, so the row
 * stays and the stats just stop competing for attention.
 */
const THIN_EVIDENCE = 3

/** Rate rather than raw wins, so the comparison holds across unequal game counts. */
function winRateOf(row: ChampionStats): number {
  return row.games === 0 ? 0 : row.wins / row.games
}

/**
 * Sort values, one per column.
 *
 * Each is the figure printed large in that cell, never the sub-line. Sorting CS
 * by CS/min instead put a 290-CS champion five rows below a 159-CS one, which
 * reads as a broken sort however defensible the rate is as a comparison.
 *
 * A deathless champion sorts above every finite ratio rather than at zero,
 * which is where `kills + assists / 0` would otherwise land it.
 */
function sortValue(row: ChampionStats, key: SortKey): number {
  switch (key) {
    case 'games':
      return row.games
    case 'winRate':
      return winRateOf(row)
    case 'kda':
      return row.deaths === 0 ? Infinity : (row.kills + row.assists) / row.deaths
    case 'damage':
      return perMinute(row.damageToChampions, row.durationSeconds) ?? 0
    case 'cs':
      return row.games === 0 ? 0 : row.cs / row.games
  }
}

const COLUMNS: Array<{ key: SortKey; label: string; width: string }> = [
  { key: 'games', label: 'Played', width: 'w-32' },
  { key: 'kda', label: 'KDA', width: 'w-28' },
  { key: 'damage', label: 'Damage', width: 'w-20' },
  { key: 'cs', label: 'CS', width: 'w-16' }
]

const GRID = 'grid-cols-[1fr_auto_auto_auto_auto]'

function SortHeader({
  label,
  width,
  active,
  dir,
  onClick
}: {
  label: string
  width: string
  active: boolean
  dir: SortDir
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      className={clsx(
        'flex items-center justify-end gap-1 transition hover:text-text-dim',
        width,
        active && 'text-accent'
      )}
    >
      {label}
      {active && (
        <Icon.ChevronDown
          width={10}
          height={10}
          className={clsx('transition-transform', dir === 'asc' && 'rotate-180')}
        />
      )}
    </button>
  )
}

/** One stat cell: a headline figure with its supporting number underneath. */
function Stat({
  width,
  primary,
  secondary,
  thin,
  tone
}: {
  width: string
  primary: string
  secondary: string
  /** Too few games to mean anything — recede rather than disappear. */
  thin: boolean
  tone?: string
}): JSX.Element {
  return (
    <div className={clsx(width, 'text-right')}>
      <p className={clsx('text-sm tabular-nums', thin ? 'text-text-mute' : (tone ?? 'text-text'))}>
        {primary}
      </p>
      <p className={clsx('text-2xs tabular-nums', thin ? 'text-text-mute/70' : 'text-text-mute')}>
        {secondary}
      </p>
    </div>
  )
}

export function Mastery({ account }: { account: Account }): JSX.Element {
  const assets = useAssets()
  // Opens on games played: the point of this screen is which champions you
  // actually play and how they perform.
  const [sort, setSort] = useState<SortKey>('games')
  const [dir, setDir] = useState<SortDir>('desc')
  const queueId = useUiStore((s) => s.championQueueFilter)
  const setQueueId = useUiStore((s) => s.setChampionQueueFilter)

  const { data: periods } = useQuery({
    queryKey: ['rankPeriods', account.id],
    queryFn: () => window.api.rank.periods(account.id)
  })

  // Null until the user picks one, so the default can follow the newest ranked
  // year that actually has games. That is not always the calendar year — in
  // January, before the first game of the new one, last year is the only thing
  // worth opening on — and it is not known until the periods query lands.
  const [picked, setPicked] = useState<RankRange | null>(null)
  const range: RankRange =
    picked ?? (periods?.[0] !== undefined ? seasonRange(periods[0].id) : 'all')
  const selectedSeason = (periods ?? []).find((s) => s.id === parseSeasonRange(range)) ?? null

  const rangeOptions: Array<[RankRange, string]> = [
    ...(periods ?? []).map((s): [RankRange, string] => [seasonRange(s.id), s.label]),
    ['all', 'All time']
  ]

  const { data, isLoading } = useQuery({
    // Both the queue and the period belong in the key, or switching either
    // would serve the previous selection's cached stats.
    queryKey: ['championStats', account.id, queueId, range],
    queryFn: () => window.api.champions.stats(account.id, queueId, range),
    // Held until the periods land, so the table never flashes a blended
    // all-time number on its way to the year the user is going to see.
    enabled: periods !== undefined
  })

  // A new column sorts descending first — "best on this stat" is the question
  // being asked nine times in ten. Re-clicking the active one flips it.
  const toggleSort = (key: SortKey): void => {
    if (key === sort) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSort(key)
      setDir('desc')
    }
  }

  if (periods === undefined || isLoading || !assets) {
    return (
      <div className="mx-auto max-w-5xl space-y-1.5 p-4">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState
        icon={<Icon.Trophy />}
        title="No champion data available"
        description="Champion stats are built from your synced match history."
      />
    )
  }

  const rows = [...data]
    // Every ordering ties constantly — a whole tail of champions on one game
    // each — so each falls through to further keys rather than leaving equal
    // rows in whatever order the query happened to return. championId last
    // makes the sort total, so the list can never reshuffle between renders.
    .sort((a, b) => {
      const delta = sortValue(b, sort) - sortValue(a, sort)
      const primary = dir === 'desc' ? delta : -delta
      // Only NaN falls through — that is Infinity - Infinity, two deathless
      // champions being genuinely indistinguishable on this key. A single
      // Infinity is a decisive answer and must not be discarded, or "Perfect"
      // sorts as if it were zero. Normalised to ±1 so the sign is all that
      // reaches Array.sort.
      if (primary !== 0 && !Number.isNaN(primary)) return primary > 0 ? 1 : -1
      return b.games - a.games || winRateOf(b) - winRateOf(a) || a.championId - b.championId
    })
    .slice(0, 50)

  const totalGames = data.reduce((n, w) => n + w.games, 0)
  const queueName = queueFilterLabel(queueId)

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl text-text">Champions</h1>
          <p className="mt-0.5 text-sm text-text-mute">
            From your {totalGames} synced {queueId === null ? '' : `${queueName} `}
            {totalGames === 1 ? 'game' : 'games'}
            {selectedSeason === null ? ' across all time' : ` in ${selectedSeason.label}`}.
            Remakes excluded.
          </p>
        </div>
        {/* Wraps because the period picker grows by one button every January. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented options={rangeOptions} value={range} onChange={setPicked} />
          <QueueFilter value={queueId} onChange={setQueueId} />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
        <div
          className={clsx(
            'grid gap-4 border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute',
            GRID
          )}
        >
          <span>Champion</span>
          {COLUMNS.map((col) => (
            <SortHeader
              key={col.key}
              label={col.label}
              width={col.width}
              active={sort === col.key}
              dir={dir}
              onClick={() => toggleSort(col.key)}
            />
          ))}
        </div>

        {/* Rendered inside the card rather than replacing the page, so the queue
            filter stays reachable — otherwise picking an empty queue would trap
            you on a screen with no way back. */}
        {rows.length === 0 && (
          <EmptyState
            icon={<Icon.Trophy />}
            title={queueId === null ? 'No champions yet' : `No ${queueName} games found`}
            description={
              selectedSeason !== null
                ? 'Nothing stored for this season. Pick another, or sync more of your match history.'
                : queueId === null
                  ? 'Sync your match history to see which champions you play and how they do.'
                  : 'Try a different queue, or sync more of your match history.'
            }
          />
        )}

        <ul className="divide-y divide-hairline/60">
          {rows.map((row) => {
            const { games, wins } = row
            const wr = wins / games
            const thin = games < THIN_EVIDENCE

            // Pooled, not a mean of per-game ratios, so the headline figure is
            // exactly what the averages beneath it divide out to.
            const kda = kdaRatio(row.kills, row.deaths, row.assists)
            const dpm = perMinute(row.damageToChampions, row.durationSeconds)
            const cspm = perMinute(row.cs, row.durationSeconds)
            const avg = (total: number): string => (total / games).toFixed(1)

            return (
              <li
                key={row.championId}
                className={clsx(
                  'grid items-center gap-4 px-4 py-2 transition hover:bg-surface',
                  GRID
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Asset
                    src={championIconUrl(assets, row.championId)}
                    className="h-9 w-9"
                    rounded="rounded-full"
                  />
                  <span className="truncate text-base text-text">
                    {championName(assets, row.championId)}
                  </span>
                </div>

                {/* Played: volume, then outcome. The count, the record and the
                    bar stay at full strength — they are raw fact at any sample
                    size. Only the percentage recedes, because a teal 100% off
                    one game is the loudest thing on the row and the least
                    earned. */}
                <div className="w-32">
                  <p className="text-right text-sm tabular-nums text-text-dim">{games}</p>
                  <Bar fraction={wr} tone="winrate" className="mt-1" />
                  <div className="mt-0.5 flex items-baseline justify-between text-2xs tabular-nums">
                    <span className="text-text-mute">
                      {wins}W {games - wins}L
                    </span>
                    <span
                      className={clsx(
                        thin ? 'text-text-mute' : wr >= 0.5 ? 'text-teal' : 'text-text-dim'
                      )}
                    >
                      {Math.round(wr * 100)}%
                    </span>
                  </div>
                </div>

                <Stat
                  width="w-28"
                  primary={kda === 'Perfect' ? 'Perfect' : `${kda}:1`}
                  secondary={`${avg(row.kills)} / ${avg(row.deaths)} / ${avg(row.assists)} (${formatPercent(row.killParticipation)})`}
                  thin={thin}
                  tone="text-teal"
                />

                <Stat
                  width="w-20"
                  primary={dpm === null ? '—' : `${Math.round(dpm)}/m`}
                  secondary={formatPercent(row.damageShare)}
                  thin={thin}
                />

                <Stat
                  width="w-16"
                  primary={String(Math.round(row.cs / games))}
                  secondary={cspm === null ? '—' : `${cspm.toFixed(1)}/m`}
                  thin={thin}
                />
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
