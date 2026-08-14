import { useQuery } from '@tanstack/react-query'
import type { Account, LiveGameParticipant } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName, spellIconUrl } from '../lib/assets'

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

/** Each row resolves its own rank so the roster paints immediately instead of waiting on 10 calls. */
function RankBadge({ platform, puuid }: { platform: string; puuid: string }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['participantRank', puuid],
    queryFn: () => window.api.liveGame.participantRank(platform, puuid),
    staleTime: 5 * 60 * 1000
  })

  if (isLoading) {
    return <span className="text-[11px] text-slate-600">loading…</span>
  }
  if (!data?.tier) {
    return <span className="text-[11px] text-slate-600">Unranked</span>
  }

  const games = (data.wins ?? 0) + (data.losses ?? 0)
  const wr = games > 0 ? Math.round(((data.wins ?? 0) / games) * 100) : null

  return (
    <span className="text-[11px]">
      <span className={TIER_COLORS[data.tier] ?? 'text-slate-300'}>
        {data.tier} {data.rank}
      </span>
      {wr !== null && <span className="text-slate-600"> · {wr}% WR</span>}
    </span>
  )
}

function ParticipantRow({
  p,
  account,
  isTracked
}: {
  p: LiveGameParticipant
  account: Account
  isTracked: boolean
}): JSX.Element {
  const assets = useAssets()
  const icon = assets ? championIconUrl(assets, p.championId) : null
  const name = assets ? championName(assets, p.championId) : ''
  const spell1 = assets ? spellIconUrl(assets, p.spell1Id) : null
  const spell2 = assets ? spellIconUrl(assets, p.spell2Id) : null

  // Some spectator payloads omit the Riot ID; look it up rather than showing "Unknown".
  const { data: resolvedName } = useQuery({
    queryKey: ['participantName', p.puuid],
    queryFn: () => window.api.liveGame.participantName(account.regionalRoute, p.puuid),
    enabled: p.gameName === null,
    staleTime: Infinity
  })

  const displayName = p.gameName ?? resolvedName?.gameName ?? 'Unknown'
  const displayTag = p.tagLine ?? resolvedName?.tagLine ?? null

  return (
    <div
      className={`flex items-center gap-2.5 rounded px-2 py-2 ${isTracked ? 'bg-slate-700/40' : ''}`}
    >
      {icon ? (
        <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded" />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded bg-slate-800" />
      )}
      <div className="flex shrink-0 flex-col gap-0.5">
        {spell1 ? <img src={spell1} alt="" className="h-3.5 w-3.5 rounded-sm" /> : null}
        {spell2 ? <img src={spell2} alt="" className="h-3.5 w-3.5 rounded-sm" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm ${isTracked ? 'font-medium text-slate-100' : 'text-slate-300'}`}
        >
          {displayName}
          {displayTag && <span className="text-slate-600">#{displayTag}</span>}
        </p>
        <p className="text-[11px] text-slate-500">{name}</p>
      </div>
      <RankBadge platform={account.platform} puuid={p.puuid} />
    </div>
  )
}

export function LiveGame({ account }: { account: Account }): JSX.Element {
  const { data, isFetching, refetch, isError, error } = useQuery({
    queryKey: ['liveGame', account.id],
    queryFn: () => window.api.liveGame.check(account.id),
    enabled: false, // manual check only — no background polling
    retry: false
  })

  const blue = data?.participants.filter((p) => p.teamId === 100) ?? []
  const red = data?.participants.filter((p) => p.teamId === 200) ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Live game</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Checks once when you click — nothing polls in the background.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isFetching ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {isError && (
        <p className="rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error instanceof Error ? error.message : 'Live game check failed'}
        </p>
      )}

      {data === null && !isFetching && (
        <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
          {account.gameName} isn&apos;t in a game right now.
        </p>
      )}

      {data && (
        <>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="rounded bg-slate-800 px-2 py-1">{data.gameMode}</span>
            <span>{Math.floor(data.gameLength / 60)} min elapsed</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-sky-400">
                Blue team
              </p>
              {blue.map((p) => (
                <ParticipantRow
                  key={p.puuid}
                  p={p}
                  account={account}
                  isTracked={p.puuid === account.puuid}
                />
              ))}
            </section>
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-rose-400">
                Red team
              </p>
              {red.map((p) => (
                <ParticipantRow
                  key={p.puuid}
                  p={p}
                  account={account}
                  isTracked={p.puuid === account.puuid}
                />
              ))}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
