import type { Account, LeagueEntry } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { profileIconUrl } from '../lib/assets'

const TIER_COLORS: Record<string, string> = {
  IRON: 'text-zinc-400',
  BRONZE: 'text-amber-700',
  SILVER: 'text-slate-300',
  GOLD: 'text-yellow-400',
  PLATINUM: 'text-teal-300',
  EMERALD: 'text-emerald-400',
  DIAMOND: 'text-sky-300',
  MASTER: 'text-purple-400',
  GRANDMASTER: 'text-rose-400',
  CHALLENGER: 'text-cyan-300'
}

function RankCard({ entry }: { entry: LeagueEntry }): JSX.Element {
  const games = (entry.wins ?? 0) + (entry.losses ?? 0)
  const winRate = games > 0 ? Math.round(((entry.wins ?? 0) / games) * 100) : null
  const tierColor = entry.tier ? (TIER_COLORS[entry.tier] ?? 'text-slate-200') : 'text-slate-500'

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        {entry.queueType === 'RANKED_SOLO_5x5' ? 'Ranked Solo/Duo' : 'Ranked Flex'}
      </p>
      <p className={`mt-1 text-base font-semibold ${tierColor}`}>
        {entry.tier ? `${entry.tier} ${entry.rank}` : 'Unranked'}
      </p>
      {entry.tier && (
        <>
          <p className="text-xs text-slate-400">{entry.leaguePoints} LP</p>
          <p className="mt-1.5 text-xs text-slate-500">
            {entry.wins}W {entry.losses}L
            {winRate !== null && (
              <span className={winRate >= 50 ? ' text-emerald-400' : ' text-rose-400'}>
                {' '}
                · {winRate}%
              </span>
            )}
          </p>
        </>
      )}
    </div>
  )
}

export function ProfileHeader({
  account,
  leagueEntries,
  onRefresh,
  refreshing
}: {
  account: Account
  leagueEntries: LeagueEntry[]
  onRefresh: () => void
  refreshing: boolean
}): JSX.Element {
  const assets = useAssets()
  const iconUrl = assets ? profileIconUrl(assets, account.profileIconId) : null

  const solo = leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5')
  const flex = leagueEntries.find((e) => e.queueType === 'RANKED_FLEX_SR')

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              className="h-16 w-16 rounded-lg border border-slate-700 object-cover"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg border border-slate-700 bg-slate-800" />
          )}
          {account.summonerLevel !== null && (
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] tabular-nums text-slate-300">
              {account.summonerLevel}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">
            {account.gameName}
            <span className="text-slate-500">#{account.tagLine}</span>
          </h1>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">
            {account.platform}
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {solo ? (
          <RankCard entry={solo} />
        ) : (
          <RankCard
            entry={{
              queueType: 'RANKED_SOLO_5x5',
              tier: null,
              rank: null,
              leaguePoints: null,
              wins: null,
              losses: null,
              fetchedAt: ''
            }}
          />
        )}
        {flex ? (
          <RankCard entry={flex} />
        ) : (
          <RankCard
            entry={{
              queueType: 'RANKED_FLEX_SR',
              tier: null,
              rank: null,
              leaguePoints: null,
              wins: null,
              losses: null,
              fetchedAt: ''
            }}
          />
        )}
      </div>
    </section>
  )
}
