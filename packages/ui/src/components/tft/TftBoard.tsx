import clsx from 'clsx'
import type { TftTrait, TftUnit } from '@foxfire/core'
import { activeTraits, ordinal } from '@foxfire/core'
import { useAssetManifest } from '../../context/assetManifest'
import { costColor, initials, placementTone, tftAsset, tftName, tftUnitCost, traitStyle } from '../../lib/tft'

/**
 * One active trait: its icon on a chip the colour of how far it is switched
 * on, then how many units carry it. Name only on hover, as op.gg does — a row
 * of eight trait names is a paragraph.
 *
 * `labelled` writes the name beside it, for the lobby and anywhere else with
 * the room.
 */
export function TraitBadge({ trait, labelled = false }: { trait: TftTrait; labelled?: boolean }): JSX.Element | null {
  const manifest = useAssetManifest()
  const style = traitStyle(trait.style)
  if (!style) return null

  const name = tftName(manifest, 'traits', trait.name)
  const icon = tftAsset(manifest, 'traits', trait.name)?.image ?? null

  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md pl-0.5 pr-1.5 text-2xs font-medium tabular-nums"
      style={{ backgroundColor: style.fill, color: style.text }}
      title={`${name} · ${trait.numUnits}`}
    >
      {icon ? (
        <img src={icon} alt="" className="h-4 w-4 object-contain" />
      ) : (
        <span aria-hidden className="flex h-4 min-w-4 items-center justify-center text-[9px] font-semibold uppercase">
          {name.slice(0, 1)}
        </span>
      )}
      {/* Named in words either way: unlabelled, the icon is all a sighted
          reader gets, and a screen reader gets nothing from it. */}
      {labelled ? <span className="whitespace-nowrap">{name}</span> : <span className="sr-only">{name}</span>}
      {trait.numUnits}
    </span>
  )
}

/** A board's active traits, strongest first, trimmed to what fits a row. */
export function TraitStrip({
  traits,
  limit,
  labelled = false
}: {
  traits: TftTrait[]
  limit?: number
  labelled?: boolean
}): JSX.Element {
  const active = activeTraits(traits)
  const shown = limit === undefined ? active : active.slice(0, limit)
  const hidden = active.length - shown.length

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((trait) => (
        <TraitBadge key={trait.name} trait={trait} labelled={labelled} />
      ))}
      {hidden > 0 && <span className="text-2xs text-text-mute">+{hidden}</span>}
    </div>
  )
}

/**
 * One unit: its portrait in a frame the colour of its cost, its stars above,
 * its items below. A unit the manifest cannot draw — an older set's — is its
 * initials on the same frame, so a board still reads at a glance.
 */
export function UnitTile({ unit, size = 'md' }: { unit: TftUnit; size?: 'sm' | 'md' }): JSX.Element {
  const manifest = useAssetManifest()
  const name = tftName(manifest, 'units', unit.characterId)
  const portrait = tftAsset(manifest, 'units', unit.characterId)?.image ?? null
  const color = costColor(tftUnitCost(manifest, unit))
  const box = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'

  return (
    <div className="flex shrink-0 flex-col items-center" title={`${name} · ${'★'.repeat(unit.tier)}`}>
      <span className="sr-only">{`${name}, ${unit.tier} star`}</span>
      <Stars count={unit.tier} color={color} />
      <div className={clsx('relative overflow-hidden rounded-md border-2 bg-surface-2', box)} style={{ borderColor: color }}>
        {portrait ? (
          <img src={portrait} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span aria-hidden className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-text-dim">
            {initials(name)}
          </span>
        )}
      </div>
      <Items items={unit.items} />
    </div>
  )
}

function Stars({ count, color }: { count: number; color: string }): JSX.Element {
  return (
    <span
      className="h-3 text-[9px] leading-3 tracking-[-1px]"
      style={{ color: count >= 3 ? color : undefined }}
      // The tile says how many in words; a row of ★ read out says nothing.
      aria-hidden
    >
      <span className={count >= 3 ? undefined : 'text-text-dim'}>{'★'.repeat(Math.min(count, 4))}</span>
    </span>
  )
}

/** A unit's items, as a row of small squares under it. Empty space when it carried none, so tiles line up. */
function Items({ items }: { items: string[] }): JSX.Element {
  const manifest = useAssetManifest()

  return (
    <span className="mt-0.5 flex h-3 gap-px">
      {items.slice(0, 3).map((item, i) => {
        const asset = tftAsset(manifest, 'items', item)
        const name = tftName(manifest, 'items', item)
        return asset?.image ? (
          <img key={`${item}-${i}`} src={asset.image} alt={name} title={name} className="h-3 w-3 rounded-[2px] object-cover" />
        ) : (
          <span
            key={`${item}-${i}`}
            role="img"
            aria-label={name}
            title={name}
            className="h-3 w-3 rounded-[2px] bg-surface-2 ring-1 ring-hairline"
          />
        )
      })}
    </span>
  )
}

/** A board's units, strongest first, as Riot already orders them. */
export function UnitStrip({ units, size = 'md' }: { units: TftUnit[]; size?: 'sm' | 'md' }): JSX.Element {
  return (
    <div className="flex items-start gap-1">
      {units.map((unit, i) => (
        <UnitTile key={`${unit.characterId}-${i}`} unit={unit} size={size} />
      ))}
    </div>
  )
}

/** A finish, as a coloured badge: `1st`. `top` is how far the good half reaches — four, or two teams. */
export function PlacementBadge({
  placement,
  top,
  className
}: {
  placement: number
  top: number
  className?: string
}): JSX.Element {
  const tone = placementTone(placement, top)

  return (
    <span
      className={clsx(
        'font-display tabular-nums',
        tone === 'first' ? 'text-gold' : tone === 'top' ? 'text-teal' : 'text-text-dim',
        className
      )}
    >
      {ordinal(placement)}
    </span>
  )
}

/** A small square for one finish, in the colour of how it went — the standing grid's cell. */
export function PlacementCell({ placement, top }: { placement: number; top: number }): JSX.Element {
  const tone = placementTone(placement, top)

  return (
    <span
      className={clsx(
        'flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold tabular-nums',
        tone === 'first'
          ? 'bg-gold text-canvas'
          : tone === 'top'
            ? 'bg-teal/80 text-canvas'
            : 'bg-surface-2 text-text-dim'
      )}
    >
      {placement}
    </span>
  )
}
