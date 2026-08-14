import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Account } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName } from '../lib/assets'

type SortKey = 'mastery' | 'games'

export function Mastery({ account }: { account: Account }): JSX.Element {
  const assets = useAssets()
  const [sort, setSort] = useState<SortKey>('mastery')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mastery', account.id],
    queryFn: () => window.api.mastery.get(account.id, false)
  })

  if (isLoading || !assets) {
    return <p className="p-6 text-sm text-slate-500">Loading champion stats…</p>
  }
  if (!data) {
    return <p className="p-6 text-sm text-slate-500">No champion data available.</p>
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

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Champions</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Mastery from Riot; win rates computed from your {data.localWinRates.reduce((n, w) => n + w.games, 0)} synced games.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-xs">
            <button
              onClick={() => setSort('mastery')}
              className={`px-3 py-1.5 transition ${sort === 'mastery' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Mastery
            </button>
            <button
              onClick={() => setSort('games')}
              className={`px-3 py-1.5 transition ${sort === 'games' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Games played
            </button>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-slate-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <span>Champion</span>
          <span className="w-20 text-right">Mastery</span>
          <span className="w-16 text-right">Games</span>
          <span className="w-20 text-right">Win rate</span>
        </div>

        <ul className="divide-y divide-slate-800/70">
          {rows.map((row) => {
            const icon = championIconUrl(assets, row.championId)
            const name = championName(assets, row.championId)
            const games = row.winRate?.games ?? 0
            const wins = row.winRate?.wins ?? 0
            const wr = games > 0 ? Math.round((wins / games) * 100) : null

            return (
              <li
                key={row.championId}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {icon ? (
                    <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded" />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded bg-slate-800" />
                  )}
                  <span className="truncate text-sm text-slate-200">{name}</span>
                </div>

                <div className="w-20 text-right">
                  {row.mastery ? (
                    <>
                      <p className="text-xs tabular-nums text-slate-300">
                        {row.mastery.championPoints.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-600">Lv {row.mastery.championLevel}</p>
                    </>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </div>

                <span className="w-16 text-right text-xs tabular-nums text-slate-400">
                  {games > 0 ? games : '—'}
                </span>

                <div className="w-20 text-right">
                  {wr !== null ? (
                    <>
                      <p
                        className={`text-xs tabular-nums ${wr >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}
                      >
                        {wr}%
                      </p>
                      <p className="text-[10px] text-slate-600">
                        {wins}W {games - wins}L
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
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
