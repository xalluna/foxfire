import type React from 'react'
import clsx from 'clsx'
import type { MatchSummary } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName, runeIconUrl, spellIconUrl } from '../lib/assets'
import { positionIcon, positionLabel } from '../lib/positions'
import { queueName } from '../lib/queues'
import { runeIds } from '../lib/runes'
import {
  compactNumber,
  perMinute,
  damageShare,
  formatAge,
  formatClock,
  formatPercent,
  kdaRatio,
  killParticipation,
  multiKillLabel
} from '../lib/matchStats'
import { Asset } from './Asset'
import { ItemStrip } from './ItemStrip'
import { Bar } from './Bar'
import { LpChip } from './LpChip'
import * as Icon from './icons'

/**
 * One collapsed match, at a fixed 72px.
 *
 * Carries op.gg's substance — spells, runes, CS/min, kill participation, items
 * — but not its two columns of ten participant names: at 109px only about four
 * rows fit an 800px window, and those names are already in the panel this row
 * expands into.
 */
export function MatchListRow({
  match,
  expanded,
  onToggle,
  onContextMenu,
  expandable = true
}: {
  match: MatchSummary
  expanded: boolean
  onToggle: () => void
  /** Opens the row's menu. Omitted where there is nothing to act on. */
  onContextMenu?: (event: React.MouseEvent) => void
  /** False for ad-hoc search results, which aren't stored and have no detail to open. */
  expandable?: boolean
}): JSX.Element {
  const assets = useAssets()

  const name = assets
    ? championName(assets, match.championId, match.championName)
    : (match.championName ?? '')

  const { keystone, secondary } = runeIds(match.perks)
  const cspm = perMinute(match.cs, match.gameDuration)
  const kp = killParticipation(match)
  const share = damageShare(match)
  const multiKill = multiKillLabel(match.largestMultiKill)
  const position = positionIcon(match.teamPosition)

  return (
    <button
      onClick={expandable ? onToggle : undefined}
      onContextMenu={onContextMenu}
      aria-expanded={expandable ? expanded : undefined}
      className={clsx(
        'flex h-[72px] w-full items-center gap-2.5 border-l-[3px] pl-2.5 pr-3 text-left transition',
        expandable && 'cursor-pointer',
        match.isRemake
          ? 'border-l-hairline bg-surface/40 hover:bg-surface'
          : match.win
            ? 'border-l-teal bg-teal/[0.06] hover:bg-teal/[0.11]'
            : 'border-l-red bg-red/[0.06] hover:bg-red/[0.11]'
      )}
    >
      {/* Result and context */}
      <div className="w-[92px] shrink-0">
        {/* A remake has a win/loss in the payload, but showing it would be
            misleading — the game was voided and counts for nothing. */}
        <p
          className={clsx(
            'font-display text-base leading-tight',
            match.isRemake ? 'text-text-dim' : match.win ? 'text-teal' : 'text-red'
          )}
        >
          {match.isRemake ? 'Remake' : match.win ? 'Victory' : 'Defeat'}
        </p>
        <p className="truncate text-2xs text-text-dim">{queueName(match.queueId, match.gameMode)}</p>
        <p className="whitespace-nowrap text-2xs tabular-nums text-text-mute">
          {formatClock(match.gameDuration)} · {formatAge(match.gameCreation)}
        </p>
        <LpChip rank={match.rank} />
      </div>

      {/* Champion, spells, runes */}
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="relative">
          <Asset
            src={assets ? championIconUrl(assets, match.championId) : null}
            className="h-11 w-11"
            rounded="rounded-full"
            title={name}
          />
          {match.champLevel !== null && (
            <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-canvas px-1 text-[9px] font-medium tabular-nums text-text-dim ring-1 ring-hairline">
              {match.champLevel}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-[3px]">
          <Asset
            src={assets && match.summoner1Id !== null ? spellIconUrl(assets, match.summoner1Id) : null}
            className="h-[19px] w-[19px]"
          />
          <Asset
            src={assets && match.summoner2Id !== null ? spellIconUrl(assets, match.summoner2Id) : null}
            className="h-[19px] w-[19px]"
          />
        </div>

        <div className="flex flex-col gap-[3px]">
          <Asset
            src={assets && keystone !== null ? runeIconUrl(assets, keystone) : null}
            className="h-[19px] w-[19px] bg-canvas"
            rounded="rounded-full"
          />
          <Asset
            src={assets && secondary !== null ? runeIconUrl(assets, secondary) : null}
            className="h-[19px] w-[19px]"
            rounded="rounded-full"
          />
        </div>
      </div>

      {/* Champion name and role */}
      <div className="w-24 shrink-0">
        <p className="truncate text-base font-medium text-text">{name}</p>
        {position && (
          <span className="mt-0.5 flex items-center gap-1 text-2xs text-text-dim">
            <img src={position} alt="" className="h-3.5 w-3.5" />
            {positionLabel(match.teamPosition)}
          </span>
        )}
      </div>

      {/* KDA */}
      <div className="w-[92px] shrink-0">
        <p className="text-base tabular-nums text-text">
          {match.kills} <span className="text-text-mute">/</span>{' '}
          <span className="text-red">{match.deaths}</span> <span className="text-text-mute">/</span>{' '}
          {match.assists}
        </p>
        <p className="text-2xs tabular-nums text-text-dim">
          {kdaRatio(match.kills, match.deaths, match.assists)}
          {match.deaths > 0 && ':1'} KDA
        </p>
      </div>

      {/* Farm and participation */}
      <div className="w-[78px] shrink-0">
        <p className="text-sm tabular-nums text-text-dim">
          {match.cs ?? 0} CS{' '}
          {cspm !== null && <span className="text-text-mute">({cspm.toFixed(1)})</span>}
        </p>
        <p className="text-2xs tabular-nums text-text-mute">P/Kill {formatPercent(kp)}</p>
      </div>

      {/* Damage share — a measured ratio, not a rating */}
      <div className="w-[72px] shrink-0">
        <p className="text-2xs tabular-nums text-text-dim">
          {compactNumber(match.damageDealtToChampions)} dmg
        </p>
        <Bar fraction={share ?? 0} className="mt-1" />
        <p className="mt-0.5 text-[9px] tabular-nums text-text-mute">
          {formatPercent(share)} of team
        </p>
      </div>

      {/* Items and badges */}
      <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
        {assets && (
          <ItemStrip
            m={assets}
            items={match.items}
            roleBound={match.roleBoundItem}
            size="h-[21px] w-[21px]"
          />
        )}
        {multiKill && (
          <span className="rounded-full border border-accent-dim bg-accent/10 px-1.5 text-[9px] font-medium uppercase tracking-wide text-accent">
            {multiKill}
          </span>
        )}
      </div>

      {/*
        Marks a game there is footage of.
        
        Not a button: the row itself is one, and nesting is invalid. Watching is
        a right-click, and this is what tells you the option will be there —
        without it, the only way to find out which games have a recording is to
        right-click them one at a time.
      */}
      {/*
        One marker for either artefact, not two.
        At 72px a row has no room to distinguish a recording from a Riot replay
        and no need to: the marker's job is "there is something to watch here",
        and the menu is where the two are told apart.
      */}
      <span className="ml-2 w-3.5 shrink-0" title={watchableTitle(match)}>
        {(match.recordingId !== null || match.replayId !== null) && (
          <Icon.Film width={14} height={14} className="text-accent/60" />
        )}
      </span>

      {expandable ? (
        <Icon.ChevronDown
          className={clsx(
            'ml-1 shrink-0 text-text-mute transition-transform',
            expanded && 'rotate-180'
          )}
        />
      ) : (
        <span className="ml-1 w-4 shrink-0" />
      )}
    </button>
  )
}

/** What the row marker promises, which depends on which artefacts exist. */
function watchableTitle(match: MatchSummary): string | undefined {
  const hasRecording = match.recordingId !== null
  const hasReplay = match.replayId !== null

  if (hasRecording && hasReplay) return 'Recording and Riot replay — right-click to watch'
  if (hasRecording) return 'Recording available — right-click to watch'
  if (hasReplay) return 'Riot replay available — right-click to watch'
  return undefined
}
