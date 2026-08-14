import { useQuery } from '@tanstack/react-query'
import type { AssetManifest, MatchParticipant } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, itemIconUrl, runeIconUrl, spellIconUrl } from '../lib/assets'

interface Perks {
  styles?: Array<{ selections?: Array<{ perk: number }>; style: number }>
}

/** Keystone is the first selection of the primary tree; secondary tree shown as its style icon. */
function runeIds(perks: unknown): { keystone: number | null; secondary: number | null } {
  const p = perks as Perks | null
  const primary = p?.styles?.[0]
  const secondary = p?.styles?.[1]
  return {
    keystone: primary?.selections?.[0]?.perk ?? null,
    secondary: secondary?.style ?? null
  }
}

function Items({ m, items }: { m: AssetManifest; items: number[] }): JSX.Element {
  // Slots 0-5 are inventory, slot 6 is the trinket.
  return (
    <div className="flex gap-0.5">
      {items.slice(0, 7).map((itemId, i) => {
        const url = itemIconUrl(m, itemId)
        return url ? (
          <img key={i} src={url} alt="" className="h-6 w-6 rounded-sm" />
        ) : (
          <div key={i} className="h-6 w-6 rounded-sm bg-slate-800/70" />
        )
      })}
    </div>
  )
}

function ParticipantRow({
  p,
  m,
  isTracked,
  maxDamage
}: {
  p: MatchParticipant
  m: AssetManifest
  isTracked: boolean
  maxDamage: number
}): JSX.Element {
  const champIcon = championIconUrl(m, p.championId)
  const { keystone, secondary } = runeIds(p.perks)
  const spell1 = p.summoner1Id !== null ? spellIconUrl(m, p.summoner1Id) : null
  const spell2 = p.summoner2Id !== null ? spellIconUrl(m, p.summoner2Id) : null
  const keystoneUrl = keystone !== null ? runeIconUrl(m, keystone) : null
  const secondaryUrl = secondary !== null ? runeIconUrl(m, secondary) : null
  const damage = p.damageDealtToChampions ?? 0
  const damagePct = maxDamage > 0 ? (damage / maxDamage) * 100 : 0

  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
        isTracked ? 'bg-slate-700/40' : ''
      }`}
    >
      <div className="relative shrink-0">
        {champIcon ? (
          <img src={champIcon} alt="" className="h-7 w-7 rounded" />
        ) : (
          <div className="h-7 w-7 rounded bg-slate-800" />
        )}
        {p.champLevel !== null && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-slate-950 px-1 text-[9px] tabular-nums text-slate-300">
            {p.champLevel}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-0.5">
        {spell1 ? <img src={spell1} alt="" className="h-3 w-3 rounded-sm" /> : <div className="h-3 w-3" />}
        {spell2 ? <img src={spell2} alt="" className="h-3 w-3 rounded-sm" /> : <div className="h-3 w-3" />}
      </div>

      <div className="flex shrink-0 flex-col gap-0.5">
        {keystoneUrl ? (
          <img src={keystoneUrl} alt="" className="h-3 w-3" />
        ) : (
          <div className="h-3 w-3" />
        )}
        {secondaryUrl ? (
          <img src={secondaryUrl} alt="" className="h-3 w-3" />
        ) : (
          <div className="h-3 w-3" />
        )}
      </div>

      <span
        className={`w-28 truncate ${isTracked ? 'font-medium text-slate-100' : 'text-slate-400'}`}
      >
        {p.gameName ?? 'Unknown'}
      </span>

      <span className="w-16 shrink-0 tabular-nums text-slate-300">
        {p.kills}/{p.deaths}/{p.assists}
      </span>

      <span className="w-14 shrink-0 tabular-nums text-slate-500">{p.cs ?? 0} cs</span>

      <div className="w-20 shrink-0">
        <div className="h-1 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-orange-500/70" style={{ width: `${damagePct}%` }} />
        </div>
        <span className="text-[10px] tabular-nums text-slate-500">
          {damage.toLocaleString()}
        </span>
      </div>

      <div className="ml-auto shrink-0">
        <Items m={m} items={p.items} />
      </div>
    </div>
  )
}

export function MatchDetailPanel({
  matchId,
  trackedPuuid
}: {
  matchId: string
  trackedPuuid: string
}): JSX.Element {
  const assets = useAssets()
  const { data, isLoading } = useQuery({
    queryKey: ['matchDetail', matchId],
    queryFn: () => window.api.dashboard.matchDetail(matchId)
  })

  if (isLoading || !assets) {
    return <div className="px-4 py-3 text-xs text-slate-500">Loading match…</div>
  }
  if (!data) {
    return <div className="px-4 py-3 text-xs text-slate-500">Match details unavailable.</div>
  }

  const blue = data.participants.filter((p) => p.teamId === 100)
  const red = data.participants.filter((p) => p.teamId === 200)
  const maxDamage = Math.max(...data.participants.map((p) => p.damageDealtToChampions ?? 0), 1)

  const teamBlock = (team: MatchParticipant[], label: string): JSX.Element => {
    const won = team[0]?.win ?? false
    return (
      <div>
        <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide">
          <span className={won ? 'text-sky-400' : 'text-rose-400'}>
            {won ? 'Victory' : 'Defeat'}
          </span>
          <span className="text-slate-600"> · {label}</span>
        </p>
        <div className="space-y-0.5">
          {team.map((p) => (
            <ParticipantRow
              key={p.puuid}
              p={p}
              m={assets}
              isTracked={p.puuid === trackedPuuid}
              maxDamage={maxDamage}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 border-t border-slate-800 bg-slate-950/60 px-2 py-3">
      {teamBlock(blue, 'Blue side')}
      {teamBlock(red, 'Red side')}
    </div>
  )
}
