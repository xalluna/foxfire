import type React from 'react'
import clsx from 'clsx'
import type { TftMatchSummary } from '@foxfire/core'
import { DOUBLE_UP_QUEUE_ID, LADDERS, countedPlacement, ladderOfQueueId } from '@foxfire/core'
import { useAssetManifest } from '../../context/assetManifest'
import { queueName } from '../../lib/queues'
import { formatAge, formatClock } from '../../lib/matchStats'
import { formatStage, placementTone, tftAsset, tftName } from '../../lib/tft'
import { LpChip } from '../LpChip'
import * as Icon from '../icons'
import { PlacementBadge, TraitStrip, UnitStrip } from './TftBoard'

/**
 * One TFT game: where it finished, which queue and when, the stage it ended
 * on and how long it lasted, then the board — active traits over the units
 * with their stars and items, as op.gg lays it out.
 *
 * The edge and tint say how it went the way League's row says victory or
 * defeat: gold for a win, teal for the rest of the good half, red below it.
 * In Double Up the team's place is the one shown and counted.
 *
 * Below 768px the augments go, and below 640px the units shrink; the traits
 * and the placement are what a glance at a TFT history is for.
 */
export function TftMatchListRow({
  match,
  expanded,
  onToggle,
  onContextMenu
}: {
  match: TftMatchSummary
  expanded: boolean
  onToggle: () => void
  onContextMenu?: (event: React.MouseEvent) => void
}): JSX.Element {
  const manifest = useAssetManifest()
  const doubleUp = match.queueId === DOUBLE_UP_QUEUE_ID && match.teamPlacement !== null
  const placement = countedPlacement(match, match.queueId)
  const top = doubleUp ? 2 : 4
  const tone = placementTone(placement, top)
  const ladder = ladderOfQueueId(match.queueId)
  const rated = ladder !== null && LADDERS[ladder].scale === 'rated'

  return (
    <button
      onClick={onToggle}
      onContextMenu={onContextMenu}
      aria-expanded={expanded}
      className={clsx(
        'flex min-h-[92px] w-full cursor-pointer items-center gap-3 border-l-[3px] py-2 pl-2.5 pr-3 text-left transition',
        tone === 'first'
          ? 'border-l-gold bg-gold/[0.07] hover:bg-gold/[0.12]'
          : tone === 'top'
            ? 'border-l-teal bg-teal/[0.06] hover:bg-teal/[0.11]'
            : 'border-l-red bg-red/[0.05] hover:bg-red/[0.10]'
      )}
    >
      <div className="w-[96px] shrink-0">
        <PlacementBadge placement={placement} top={top} className="text-xl leading-tight" />
        {doubleUp && <span className="ml-1 text-2xs text-text-mute">team</span>}
        <p className="truncate text-2xs text-text-dim">
          {ladder ? LADDERS[ladder].shortLabel : queueName(match.queueId, 'TFT')}
        </p>
        <p className="whitespace-nowrap text-2xs tabular-nums text-text-mute">{formatAge(match.gameCreation)}</p>
        <p className="whitespace-nowrap text-2xs tabular-nums text-text-mute">
          {formatStage(match.lastRound, match.queueId)} · {formatClock(Math.round(match.timeEliminated))}
        </p>
        <LpChip rank={match.rank} unit={rated ? 'rating' : 'LP'} />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5 overflow-hidden">
        <TraitStrip traits={match.traits} limit={7} />
        <div className="max-sm:hidden">
          <UnitStrip units={match.units} />
        </div>
        <div className="sm:hidden">
          <UnitStrip units={match.units} size="sm" />
        </div>
      </div>

      <div className="hidden w-[64px] shrink-0 flex-col items-end gap-1 md:flex">
        <span className="text-2xs tabular-nums text-text-dim">Lv {match.level}</span>
        <div className="flex gap-0.5">
          {match.augments.slice(0, 3).map((augment) => {
            const icon = tftAsset(manifest, 'augments', augment)?.image ?? null
            const name = tftName(manifest, 'augments', augment)
            return icon ? (
              <img key={augment} src={icon} alt="" title={name} className="h-4 w-4 rounded-full object-cover" />
            ) : (
              <span key={augment} title={name} className="h-4 w-4 rounded-full bg-surface-2 ring-1 ring-hairline" />
            )
          })}
        </div>
      </div>

      {/* There is footage of this game: watching is a right-click, as on League's rows. */}
      <span className="w-3.5 shrink-0">
        {((match.local?.recordingId ?? null) !== null || match.recording) && (
          <Icon.Film width={14} height={14} className="text-accent/60" />
        )}
      </span>

      <Icon.ChevronDown className={clsx('shrink-0 text-text-mute transition-transform', expanded && 'rotate-180')} />
    </button>
  )
}
