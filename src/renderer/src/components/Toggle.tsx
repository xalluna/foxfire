import clsx from 'clsx'

/**
 * A labelled checkbox with explanatory copy underneath.
 *
 * Extracted from RankTrackingSettings when the telemetry card needed the same
 * shape — both are settings that change how the app behaves in the background
 * and both need room to explain the trade-off rather than just naming it.
 */
export function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-start gap-3 rounded-md border border-hairline bg-canvas p-3',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
      />
      <span className="min-w-0">
        <span className="block text-sm text-text">{label}</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">{description}</span>
      </span>
    </label>
  )
}
