import clsx from 'clsx'
import { ALL_TIERS, APEX_TIERS, DIVISIONS, rankFromLeaguePoints } from '@shared/ladder'
import type { ManualRank } from '@shared/types'

const APEX = APEX_TIERS as readonly string[]

/** Whether a tier is decided by ladder cutoffs, and so has no divisions. */
export function isApexTier(tier: string): boolean {
  return APEX.includes(tier)
}

/** GRANDMASTER reads badly in a 90px control. */
function tierLabel(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase()
}

const SELECT_CLASS =
  'h-7 rounded-md border border-hairline bg-canvas px-2 text-2xs text-text ' +
  'focus:border-gold-dim focus:outline-none disabled:cursor-not-allowed disabled:text-text-mute'

/**
 * Tier, division and LP as three controls.
 *
 * Divisions disable above Diamond rather than disappearing, so the row does not
 * change width as the tier changes — a list of these would otherwise reflow
 * every time one was touched. LP loses its 0–99 ceiling there too: Master and
 * above run on one continuous scale with no division to cross.
 *
 * `from` is what makes this quick to fill: the selects start on the rank the
 * game began at, and typing an LP number alone moves them to whichever division
 * that number actually lands in. Most games need nothing but the number.
 * Changing a select afterwards sticks — only editing LP re-infers — so an
 * unusual result can still be stated outright.
 */
export function RankInput({
  value,
  from,
  onChange,
  disabled = false
}: {
  value: ManualRank | null
  /** The rank going in, used to seed the selects and place a bare LP figure. */
  from?: ManualRank | null
  onChange: (next: ManualRank) => void
  disabled?: boolean
}): JSX.Element {
  // Falls back to the starting rank so the controls read as filled before
  // anything is typed, without that counting as an entry — the row only
  // becomes pending once `value` itself is set.
  const tier = value?.tier ?? from?.tier ?? ''
  const division = value?.rank ?? from?.rank ?? null
  const apex = tier !== '' && isApexTier(tier)

  const update = (patch: Partial<ManualRank>): void =>
    onChange({
      tier: patch.tier ?? tier,
      rank: patch.rank !== undefined ? patch.rank : (division ?? 'IV'),
      leaguePoints: patch.leaguePoints ?? value?.leaguePoints ?? 0
    })

  const updateLeaguePoints = (leaguePoints: number): void => {
    const placed = from ? rankFromLeaguePoints(from, leaguePoints) : null
    if (placed) onChange(placed)
    else update({ leaguePoints })
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Tier"
        value={tier}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value
          // Moving into an apex tier drops the division and lifts the LP cap;
          // moving back out needs a division again or the rank cannot be placed.
          update({ tier: next, rank: isApexTier(next) ? null : (division ?? 'IV') })
        }}
        className={clsx(SELECT_CLASS, 'w-[92px]')}
      >
        <option value="" disabled>
          Tier
        </option>
        {ALL_TIERS.map((t) => (
          <option key={t} value={t}>
            {tierLabel(t)}
          </option>
        ))}
      </select>

      <select
        aria-label="Division"
        value={apex ? '' : (division ?? '')}
        disabled={disabled || apex || tier === ''}
        onChange={(e) => update({ rank: e.target.value })}
        className={clsx(SELECT_CLASS, 'w-[58px]')}
      >
        <option value="" disabled>
          —
        </option>
        {DIVISIONS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      <input
        type="number"
        aria-label="League points"
        min={0}
        max={apex ? undefined : 99}
        step={1}
        disabled={disabled || tier === ''}
        value={value?.leaguePoints ?? ''}
        placeholder="LP"
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10)
          updateLeaguePoints(Number.isNaN(parsed) ? 0 : parsed)
        }}
        className={clsx(
          'h-7 w-[62px] rounded-md border border-hairline bg-canvas px-2 text-2xs tabular-nums text-text',
          'placeholder:text-text-mute focus:border-gold-dim focus:outline-none',
          'disabled:cursor-not-allowed disabled:text-text-mute'
        )}
      />
      <span className="text-2xs text-text-mute">LP</span>
    </div>
  )
}

/** The read-only counterpart, for the rank a game started from. */
export function RankLabel({ rank }: { rank: ManualRank | null }): JSX.Element {
  if (!rank) return <span className="text-2xs text-text-mute">Unknown</span>
  return (
    <span className="text-2xs tabular-nums text-text-dim">
      {tierLabel(rank.tier)}
      {!isApexTier(rank.tier) && rank.rank ? ` ${rank.rank}` : ''} {rank.leaguePoints} LP
    </span>
  )
}
