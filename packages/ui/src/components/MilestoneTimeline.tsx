import { useState } from 'react'
import clsx from 'clsx'
import { format } from 'date-fns'
import type { MilestoneEntry, RankMilestone } from '@foxfire/core'
import * as Icon from './icons'
import { formatDayRange } from '../lib/format'
import { ratedTierColor, ratedTierLabel, tierColor, tierCrest, tierLabel } from '../lib/rank'

/** What a milestone crossed into, and the colour it is said in. */
function crossedInto(m: RankMilestone, rated: boolean): { label: string; color: string } {
  return rated
    ? { label: ratedTierLabel(m.ratedTier), color: ratedTierColor(m.ratedTier) }
    : { label: tierLabel(m.tier, m.rank), color: tierColor(m.tier) }
}

/** A colour at a fraction of its strength, whether it is a hex or a token. */
function faded(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/**
 * The line the nodes hang on, drawn in two pieces around this row's node so
 * the first row starts at its node and the last ends at one. Every node is
 * 28px, 10px down its row, so the pieces stop just short of it either side and
 * the rows' pieces meet end to end. Dashed through a fold.
 *
 * In the muted text colour rather than the hairline: the hairline is a card's
 * edge, and a line that short in it disappears against the card.
 */
function Rail({ first, last, dashed }: { first: boolean; last: boolean; dashed: boolean }): JSX.Element {
  const line = dashed ? 'border-l border-dashed border-text-mute/60' : 'w-px bg-text-mute/60'
  return (
    <>
      {!first && <span aria-hidden className={clsx('absolute left-[30px] top-0 h-[8px]', line)} />}
      {!last && <span aria-hidden className={clsx('absolute bottom-0 left-[30px] top-[40px]', line)} />}
    </>
  )
}

/** A crossing's node: its crest, or on a rated ladder a swatch of its colour. */
function Crest({ milestone, rated, peak }: { milestone: RankMilestone; rated: boolean; peak: boolean }): JSX.Element {
  const promoted = milestone.movement === 'promotion'
  const { color } = crossedInto(milestone, rated)
  // A static glow, never a pulse: a peak should read as held, not as an alert.
  const glow = peak ? faded(color, 55) : null

  if (rated) {
    return (
      <span
        className={clsx('rounded-full', peak ? 'h-3.5 w-3.5' : 'h-3 w-3', !promoted && 'opacity-50')}
        style={{ backgroundColor: color, boxShadow: glow ? `0 0 8px ${glow}` : undefined }}
      />
    )
  }

  const crest = tierCrest(milestone.tier)
  if (!crest) return <span className="h-7 w-7" />
  return (
    <img
      src={crest}
      alt=""
      className={clsx('object-contain', peak ? '-m-0.5 h-8 w-8' : 'h-7 w-7', !promoted && 'opacity-50')}
      style={glow ? { filter: `drop-shadow(0 0 6px ${glow})` } : undefined}
    />
  )
}

/**
 * One crossing on the line. A peak says so with its crest's glow and nothing
 * else — a label on top read as cheering somebody on. A return is simply left
 * unfolded, which is already what sets it apart.
 */
function MilestoneRow({
  milestone,
  peak,
  rated,
  first,
  last
}: {
  milestone: RankMilestone
  peak: boolean
  rated: boolean
  first: boolean
  last: boolean
}): JSX.Element {
  const into = crossedInto(milestone, rated)

  return (
    <li className="relative">
      <Rail first={first} last={last} dashed={false} />
      <div className="flex items-start gap-3 px-4 py-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center">
          <Crest milestone={milestone} rated={rated} peak={peak} />
        </div>
        <p className="flex min-h-7 min-w-0 flex-1 items-center text-sm" style={{ color: into.color }}>
          <span>
            {milestone.movement === 'promotion' ? 'Promoted to' : 'Demoted to'} {into.label}
            {/* The glow is the mark; a screen reader needs it in words. */}
            {peak && <span className="sr-only">, a new peak this season</span>}
          </span>
        </p>
        <p className="flex h-7 shrink-0 items-center text-2xs tabular-nums text-text-mute">
          {format(milestone.capturedAt, 'MMM d, HH:mm')}
        </p>
      </div>
    </li>
  )
}

/** The two divisions a fold went between, small and quiet, one over the other. */
function StretchNode({ lower, upper, rated }: { lower: RankMilestone; upper: RankMilestone; rated: boolean }): JSX.Element {
  if (rated) {
    return (
      <span className="flex -space-x-1 opacity-60">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ratedTierColor(lower.ratedTier) }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ratedTierColor(upper.ratedTier) }} />
      </span>
    )
  }

  const below = tierCrest(lower.tier)
  const above = tierCrest(upper.tier)
  return (
    <span className="relative h-7 w-7 opacity-60">
      {below && <img src={below} alt="" className="absolute bottom-0 left-0 h-5 w-5 object-contain" />}
      {above && <img src={above} alt="" className="absolute right-0 top-0 h-5 w-5 object-contain" />}
    </span>
  )
}

function StretchRow({
  milestones,
  lower,
  upper,
  rated,
  open,
  onToggle,
  first,
  last
}: {
  milestones: RankMilestone[]
  lower: RankMilestone
  upper: RankMilestone
  rated: boolean
  open: boolean
  onToggle: () => void
  first: boolean
  last: boolean
}): JSX.Element {
  const ended = milestones[0]
  const began = milestones[milestones.length - 1]

  return (
    <li className="relative">
      {/* Open at the bottom of the list, the line carries on past its rows. */}
      <Rail first={first} last={last && !open} dashed />
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-surface/60"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center">
          <StretchNode lower={lower} upper={upper} rated={rated} />
        </span>
        <span className="flex min-h-7 min-w-0 flex-1 flex-col justify-center">
          <span className="flex items-center gap-1.5 text-sm text-text-dim">
            {crossedInto(lower, rated).label}
            <Icon.ArrowsLeftRight className="h-3 w-3 shrink-0 text-text-mute" />
            <span className="sr-only">and</span>
            {crossedInto(upper, rated).label}
          </span>
          <span className="text-2xs text-text-mute">
            {milestones.length} changes · ended {crossedInto(ended, rated).label}
          </span>
        </span>
        <span className="flex h-7 shrink-0 items-center gap-2 text-2xs tabular-nums text-text-mute">
          {formatDayRange(began.capturedAt, ended.capturedAt)}
          <Icon.ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
        </span>
      </button>

      {open && (
        <ol className="pb-2">
          {milestones.map((m) => {
            const into = crossedInto(m, rated)
            return (
              <li key={`${m.capturedAt}-${m.movement}`} className="flex items-center gap-3 px-4 py-1">
                <span className="flex w-7 shrink-0 justify-center">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: faded(into.color, 70) }} />
                </span>
                <p className="min-w-0 flex-1 text-xs" style={{ color: faded(into.color, 75) }}>
                  {m.movement === 'promotion' ? 'Promoted to' : 'Demoted to'} {into.label}
                </p>
                <p className="shrink-0 text-2xs tabular-nums text-text-mute">{format(m.capturedAt, 'MMM d, HH:mm')}</p>
              </li>
            )
          })}
        </ol>
      )}
    </li>
  )
}

/**
 * The milestones as a timeline, newest at the top — see milestoneTimeline in
 * core for what folds and what is kept out.
 *
 * A fold starts closed: the back-and-forth is there for anyone who wants it,
 * but the line reads as the climb. Which folds are open is this view's own and
 * forgotten on leaving; nothing about it is worth keeping.
 */
export function MilestoneTimeline({ entries, rated }: { entries: MilestoneEntry[]; rated: boolean }): JSX.Element {
  // Keyed by a fold's newest crossing, which no other fold can share.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())

  const toggle = (key: number): void =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <ol className="py-1.5">
      {entries.map((entry, i) => {
        const first = i === 0
        const last = i === entries.length - 1

        if (entry.kind === 'milestone') {
          const m = entry.milestone
          return (
            <MilestoneRow
              key={`${m.capturedAt}-${m.movement}`}
              milestone={m}
              peak={entry.note?.kind === 'peak'}
              rated={rated}
              first={first}
              last={last}
            />
          )
        }

        const key = entry.milestones[0].capturedAt
        return (
          <StretchRow
            key={`stretch-${key}`}
            milestones={entry.milestones}
            lower={entry.lower}
            upper={entry.upper}
            rated={rated}
            open={open.has(key)}
            onToggle={() => toggle(key)}
            first={first}
            last={last}
          />
        )
      })}
    </ol>
  )
}
