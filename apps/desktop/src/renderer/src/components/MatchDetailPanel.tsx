import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { AssetManifest, MatchParticipant } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, runeIconUrl, spellIconUrl } from '../lib/assets'
import { positionIcon } from '../lib/positions'
import { runeIds } from '../lib/runes'
import { compactNumber } from '../lib/matchStats'
import { formatRiotId } from '../lib/riotId'
import { Asset } from './Asset'
import { ItemStrip } from './ItemStrip'
import { Bar } from './Bar'
import { Skeleton } from './Skeleton'
import * as Icon from './icons'

/** A labelled proportion bar. Both damage columns share a lobby-wide scale so rows compare directly. */
function StatBar({
  value,
  max,
  tone
}: {
  value: number
  max: number
  tone: 'damage' | 'taken'
}): JSX.Element {
  return (
    <div className="w-full">
      <p className="text-[10px] leading-tight tabular-nums text-text-dim">
        {compactNumber(value)}
      </p>
      <Bar
        fraction={max > 0 ? value / max : 0}
        tone={tone === 'damage' ? 'accent' : 'taken'}
        className="mt-0.5"
      />
    </div>
  )
}

function ParticipantRow({
  p,
  m,
  isTracked,
  maxDamage,
  maxTaken
}: {
  p: MatchParticipant
  m: AssetManifest
  isTracked: boolean
  maxDamage: number
  maxTaken: number
}): JSX.Element {
  const { keystone, secondary } = runeIds(p.perks)
  const position = positionIcon(p.teamPosition)

  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded px-2 py-1',
        isTracked && 'bg-accent/10 ring-1 ring-inset ring-accent/25'
      )}
    >
      {position ? (
        <img src={position} alt="" className="h-4 w-4 shrink-0" />
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}

      <div className="relative shrink-0">
        <Asset
          src={championIconUrl(m, p.championId)}
          className="h-8 w-8"
          rounded="rounded-full"
        />
        {p.champLevel !== null && (
          <span className="absolute -bottom-0.5 -right-1 rounded-full bg-canvas px-1 text-[9px] tabular-nums text-text-dim ring-1 ring-hairline">
            {p.champLevel}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-[2px]">
        <Asset
          src={p.summoner1Id !== null ? spellIconUrl(m, p.summoner1Id) : null}
          className="h-[15px] w-[15px]"
        />
        <Asset
          src={p.summoner2Id !== null ? spellIconUrl(m, p.summoner2Id) : null}
          className="h-[15px] w-[15px]"
        />
      </div>

      <div className="flex shrink-0 flex-col gap-[2px]">
        <Asset
          src={keystone !== null ? runeIconUrl(m, keystone) : null}
          className="h-[15px] w-[15px] bg-canvas"
          rounded="rounded-full"
        />
        <Asset
          src={secondary !== null ? runeIconUrl(m, secondary) : null}
          className="h-[15px] w-[15px]"
          rounded="rounded-full"
        />
      </div>

      <span
        className={clsx(
          'w-32 shrink-0 truncate text-sm',
          isTracked ? 'font-medium text-text' : 'text-text-dim'
        )}
        title={formatRiotId(p.gameName, p.tagLine)}
      >
        {p.gameName ?? 'Unknown'}
      </span>

      <span className="w-[74px] shrink-0 text-sm tabular-nums text-text-dim">
        {p.kills} <span className="text-text-mute">/</span>{' '}
        <span className="text-red">{p.deaths}</span> <span className="text-text-mute">/</span>{' '}
        {p.assists}
      </span>

      <span className="w-14 shrink-0 text-2xs tabular-nums text-text-mute">{p.cs ?? 0} CS</span>

      {/* The coin leads the figure rather than trailing it. Trailing, it moved
          with the digit count — tabular-nums equalises how wide digits are, not
          how many there are — so 8.1k and 13.1k put it in different places and
          ten rows of it never lined up. It is a glyph rather than the letter
          "g" because the "g" butted against compactNumber's "k" and read as a
          kilogram. */}
      <span className="flex w-14 shrink-0 items-center gap-1 text-2xs tabular-nums text-text-mute">
        <Icon.Coin width={11} height={11} className="shrink-0 text-gold" />
        {compactNumber(p.goldEarned)}
      </span>

      <div className="w-16 shrink-0">
        <StatBar value={p.damageDealtToChampions ?? 0} max={maxDamage} tone="damage" />
      </div>

      <div className="w-16 shrink-0">
        <StatBar value={p.damageTaken ?? 0} max={maxTaken} tone="taken" />
      </div>

      <div className="ml-auto shrink-0">
        <ItemStrip m={m} items={p.items} roleBound={p.roleBoundItem} />
      </div>
    </div>
  )
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, v) => total + (v ?? 0), 0)
}

/**
 * The expanded scoreboard.
 *
 * Surfaces gold, damage taken and role — all stored since the first migration
 * but never rendered before. Damage bars are normalised across all ten players
 * rather than per team, so a carry on the losing side still reads as a carry.
 */
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
    return (
      <div className="space-y-1 border-t border-hairline bg-canvas/60 p-3">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (!data) {
    return (
      <p className="border-t border-hairline bg-canvas/60 px-4 py-3 text-sm text-text-mute">
        Match details unavailable.
      </p>
    )
  }

  const maxDamage = Math.max(...data.participants.map((p) => p.damageDealtToChampions ?? 0), 1)
  const maxTaken = Math.max(...data.participants.map((p) => p.damageTaken ?? 0), 1)

  const teamBlock = (teamId: number, label: string): JSX.Element => {
    const team = data.participants.filter((p) => p.teamId === teamId)
    const won = team[0]?.win ?? false

    return (
      <div>
        <div className="mb-1 flex items-baseline gap-2 px-2">
          <span
            className={clsx('font-display text-base', won ? 'text-teal' : 'text-red')}
          >
            {won ? 'Victory' : 'Defeat'}
          </span>
          <span className="text-2xs uppercase tracking-widest text-text-mute">{label}</span>
          <span className="ml-auto flex items-center gap-1 text-2xs tabular-nums text-text-mute">
            {sum(team.map((p) => p.kills))} kills ·{' '}
            <Icon.Coin width={11} height={11} className="shrink-0 text-gold" />
            {compactNumber(sum(team.map((p) => p.goldEarned)))}
          </span>
        </div>
        <div className="space-y-0.5">
          {team.map((p) => (
            <ParticipantRow
              key={p.puuid}
              p={p}
              m={assets}
              isTracked={p.puuid === trackedPuuid}
              maxDamage={maxDamage}
              maxTaken={maxTaken}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 border-t border-hairline bg-canvas/60 px-2 py-3">
      {teamBlock(100, 'Blue side')}
      {teamBlock(200, 'Red side')}
    </div>
  )
}
