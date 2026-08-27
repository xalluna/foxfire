import type { ReactNode } from 'react'
import clsx from 'clsx'
import * as Icon from '../icons'
import {
  checkboxClass,
  dangerButtonClass,
  ghostButtonClass,
  inputClass,
  readonlyInputClass
} from './controls'

const GB = 1024 * 1024 * 1024

/**
 * The row grammar every settings card is built from.
 *
 * One shape repeated: what the setting is on the left, the control that changes
 * it on the right. `description` is optional and deliberately so — most rows
 * name themselves ("Recording folder", "Start with Windows") and a mandatory
 * second line on those only pushed the page taller. It is kept for the handful
 * that teach something the label cannot.
 *
 * Not everything fits a row. A queue grid, an OBS preview or a season editor is
 * a `SettingsBlock`: same padding and the same hairline above it, but spanning
 * the full width with no right-hand control. Mixing the two inside one card is
 * the point — the page stays one visual system rather than a card of rows
 * followed by a pile of loose widgets.
 */
export function SettingsRow({
  label,
  description,
  control,
  className
}: {
  label: ReactNode
  description?: ReactNode
  /** Pinned right. A checkbox, a select, a button, a value. */
  control?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={clsx('flex items-center gap-4 px-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <span className="block text-sm text-text">{label}</span>
        {description !== undefined && (
          <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">{description}</span>
        )}
      </div>
      {control !== undefined && <div className="flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  )
}

/** A row whose content spans the width: grids, previews, editors, warnings. */
export function SettingsBlock({
  label,
  description,
  children,
  className
}: {
  label?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  const titled = label !== undefined || description !== undefined

  return (
    <div className={clsx('px-4 py-3', className)}>
      {label !== undefined && <span className="block text-sm text-text">{label}</span>}
      {description !== undefined && (
        <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">{description}</span>
      )}
      <div className={titled ? 'mt-2.5' : undefined}>{children}</div>
    </div>
  )
}

/**
 * A setting you switch on and off.
 *
 * The whole row is the label element, so the click target is the row rather
 * than a 16px box at the end of it. The control stays a native checkbox — the
 * radios, queue filters and season flags elsewhere in Settings are native too,
 * and one styled switch among them would read as a different kind of control
 * rather than a tidier one.
 */
export function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-center gap-4 px-4 py-3 transition hover:bg-surface-2/40',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text">{label}</span>
        {description !== undefined && (
          <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">{description}</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={checkboxClass}
      />
    </label>
  )
}

/**
 * How a page reports the state of the thing it configures.
 *
 * Folding used to hide that state, which is why every section carried a
 * one-word summary beside its chevron. Nothing folds now, so the fact moves to
 * where it belongs: the first row of the page's first card, in a sentence.
 *
 * Only problems are tinted. A teal panel announcing that everything is fine is
 * the loudest thing on a page where nothing has happened, and it trains the eye
 * to skip exactly the colour that matters when something does break.
 */
export function StatusRow({
  tone,
  children
}: {
  /**
   * `recording` is red but untinted: something is happening right now, which is
   * neither good news nor a problem, and a warning triangle beside it would be
   * a lie.
   */
  tone: 'good' | 'mute' | 'warn' | 'error' | 'recording'
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className={clsx(
        'flex items-start gap-2 px-4 py-3 text-sm',
        tone === 'good' && 'text-teal',
        tone === 'mute' && 'text-text-dim',
        tone === 'recording' && 'text-red',
        tone === 'warn' && 'bg-amber/10 text-amber',
        tone === 'error' && 'bg-red/10 text-red'
      )}
    >
      {tone === 'good' ? (
        <Icon.Check className="mt-0.5 shrink-0" width={14} height={14} />
      ) : tone === 'recording' ? (
        <Icon.Record className="mt-0.5 shrink-0" width={14} height={14} />
      ) : (
        <Icon.Warning className="mt-0.5 shrink-0" width={14} height={14} />
      )}
      <span className="min-w-0 leading-relaxed">{children}</span>
    </div>
  )
}

/**
 * A folder, and the buttons that change it.
 *
 * Stacked rather than right-aligned like every other row: these are Windows
 * paths, and one truncated to fit beside two buttons in a 768px column tells
 * you nothing you did not already know.
 */
export function PathRow({
  label,
  description,
  value,
  placeholder = 'Not found',
  disabled,
  onBrowse,
  onClear
}: {
  label: string
  description?: string
  value: string | null
  placeholder?: string
  disabled?: boolean
  /** Null when the path is reported rather than chosen. */
  onBrowse: (() => void) | null
  /** Null when there is nothing to fall back to. */
  onClear?: (() => void) | null
}): JSX.Element {
  return (
    <SettingsBlock label={label} description={description}>
      <div className="flex items-center gap-2">
        <input readOnly value={value ?? placeholder} className={readonlyInputClass} />
        {onBrowse !== null && (
          <button type="button" disabled={disabled} onClick={onBrowse} className={ghostButtonClass}>
            Browse
          </button>
        )}
        {onClear !== null && onClear !== undefined && (
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            title="Go back to whatever the League client reports"
            className={ghostButtonClass}
          >
            Reset
          </button>
        )}
      </div>
    </SettingsBlock>
  )
}

/**
 * A row that opens a separate window.
 *
 * Both of the extra windows — archived clients and the telemetry panel — are
 * reached this way, and the glyph is the promise: this leaves the page rather
 * than expanding it.
 */
export function LinkRow({
  label,
  description,
  onClick
}: {
  label: string
  description?: ReactNode
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-surface-2/40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text">{label}</span>
        {description !== undefined && (
          <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">{description}</span>
        )}
      </span>
      <Icon.ExternalLink className="shrink-0 text-text-mute" width={14} height={14} />
    </button>
  )
}

/** A soft size limit, in whole gigabytes. A reminder rather than a cap. */
export function ByteCapRow({
  label,
  description,
  bytes,
  unit,
  disabled,
  onChange
}: {
  label: string
  description?: string
  bytes: number
  /** What is being measured: "GB of replays", "GB". */
  unit: string
  disabled?: boolean
  onChange: (bytes: number) => void
}): JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <>
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={Math.round(bytes / GB)}
            onChange={(event) => onChange(Math.max(0, Number(event.target.value)) * GB)}
            className={clsx(inputClass, 'w-20 tabular-nums')}
          />
          <span className="text-2xs text-text-dim">{unit}</span>
        </>
      }
    />
  )
}

/** Three figures across. Disk usage, telemetry buffer. */
export function StatRow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <SettingsBlock>
      <dl className="grid grid-cols-3 gap-3">{children}</dl>
    </SettingsBlock>
  )
}

export function Stat({
  label,
  value,
  tone = 'normal'
}: {
  label: string
  value: string
  tone?: 'normal' | 'warn'
}): JSX.Element {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-widest text-text-mute">{label}</dt>
      <dd className={clsx('mt-1 font-mono text-sm', tone === 'warn' ? 'text-amber' : 'text-text')}>
        {value}
      </dd>
    </div>
  )
}

/** A destructive action, kept quiet until hovered. */
export function DangerRow({
  label,
  description,
  action,
  disabled,
  onClick
}: {
  label: string
  description?: string
  action: string
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <button type="button" disabled={disabled} onClick={onClick} className={dangerButtonClass}>
          {action}
        </button>
      }
    />
  )
}
