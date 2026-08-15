import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Account } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName } from '../lib/assets'
import { Asset } from '../components/Asset'
import { EmptyState } from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'

type SortKey = 'mastery' | 'games'

export function Mastery({ account }: { account: Account }): JSX.Element {
  const assets = useAssets()
  const [sort, setSort] = useState<SortKey>('mastery')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mastery', account.id],
    queryFn: () => window.api.mastery.get(account.id, false)
  })

  if (isLoading || !assets) {
    return (
      <div className="mx-auto max-w-4xl space-y-1.5 p-4">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState
        icon={<Icon.Trophy />}
        title="No champion data available"
        description="Champion mastery comes from Riot and needs a valid API key."
      />
    )
  }

  const winRateByChamp = new Map(data.localWinRates.map((w) => [w.championId, w]))
  const masteryByChamp = new Map(data.riotMastery.map((m) => [m.championId, m]))

  // Union of both sources: champions you've played recently and champions you
  // have mastery on but no synced games for.
  const championIds = new Set<number>([
    ...data.riotMastery.map((m) => m.championId),
    ...data.localWinRates.map((w) => w.championId)
  ])

  const rows = [...championIds]
    .map((id) => ({
      championId: id,
      mastery: masteryByChamp.get(id) ?? null,
      winRate: winRateByChamp.get(id) ?? null
    }))
    .sort((a, b) => {
      if (sort === 'games') {
        return (b.winRate?.games ?? 0) - (a.winRate?.games ?? 0)
      }
      return (b.mastery?.championPoints ?? 0) - (a.mastery?.championPoints ?? 0)
    })
    .slice(0, 50)

  const totalGames = data.localWinRates.reduce((n, w) => n + w.games, 0)
  const maxPoints = Math.max(...rows.map((r) => r.mastery?.championPoints ?? 0), 1)

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Icon.Trophy />}
        title="No champions yet"
        description="Sync your match history, or refresh to pull mastery from Riot."
      />
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl text-text">Champions</h1>
          <p className="mt-0.5 text-sm text-text-mute">
            Mastery from Riot; win rates computed locally from your {totalGames} synced games.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-hairline text-sm">
            {(
              [
                ['mastery', 'Mastery'],
                ['games', 'Games played']
              ] as Array<[SortKey, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={clsx(
                  'px-3 py-1.5 transition',
                  sort === key ? 'bg-gold/10 text-gold' : 'text-text-dim hover:bg-surface'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-gold-dim hover:text-gold disabled:opacity-50"
          >
            <Icon.Sync className={isFetching ? 'animate-spin' : undefined} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
          <span>Champion</span>
          <span className="w-28 text-right">Mastery</span>
          <span className="w-14 text-right">Games</span>
          <span className="w-24 text-right">Win rate</span>
        </div>

        <ul className="divide-y divide-hairline/60">
          {rows.map((row) => {
            const games = row.winRate?.games ?? 0
            const wins = row.winRate?.wins ?? 0
            const wr = games > 0 ? Math.round((wins / games) * 100) : null

            return (
              <li
                key={row.championId}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2 transition hover:bg-surface"
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

                <div className="w-28 text-right">
                  {row.mastery ? (
                    <>
                      <p className="text-sm tabular-nums text-text-dim">
                        {row.mastery.championPoints.toLocaleString()}
                        <span className="ml-1.5 text-2xs text-gold">
                          Lv {row.mastery.championLevel}
                        </span>
                      </p>
                      {/* Relative to this player's best champion, not an absolute scale. */}
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-gold/60"
                          style={{ width: `${(row.mastery.championPoints / maxPoints) * 100}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-sm text-text-mute">—</span>
                  )}
                </div>

                <span className="w-14 text-right text-sm tabular-nums text-text-dim">
                  {games > 0 ? games : '—'}
                </span>

                <div className="w-24 text-right">
                  {wr !== null ? (
                    <>
                      <p
                        className={clsx(
                          'text-sm tabular-nums',
                          wr >= 50 ? 'text-teal' : 'text-text-dim'
                        )}
                      >
                        {wr}%
                      </p>
                      <p className="text-2xs tabular-nums text-text-mute">
                        {wins}W {games - wins}L
                      </p>
                    </>
                  ) : (
                    <span className="text-sm text-text-mute">—</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
