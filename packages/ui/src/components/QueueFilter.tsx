import { QUEUE_FILTER_OPTIONS } from '@foxfire/core'

/**
 * The queue selector shared by match history and champion stats.
 *
 * A native <select> rather than a bespoke popover: the option list is long
 * enough that a segmented control would not fit, and the platform control
 * brings keyboard navigation, type-ahead and screen-reader support that a
 * hand-rolled dropdown would have to reimplement. The arrow is drawn as an
 * inline background image so the chevron can carry the accent rather than the
 * OS grey. The hex is written out because a data URI is its own document and
 * inherits no currentColor; it tracks --accent in styles/index.css by hand.
 */
export function QueueFilter({
  value,
  onChange,
  label = 'Queue'
}: {
  value: number | null
  onChange: (queueId: number | null) => void
  label?: string
}): JSX.Element {
  return (
    <select
      aria-label={label}
      // null has no string form in an <option>, so 'all' stands in for it.
      value={value === null ? 'all' : String(value)}
      onChange={(e) => onChange(e.target.value === 'all' ? null : Number(e.target.value))}
      // h-8 matches the segmented toggles and buttons it sits beside; without
      // it a <select> sizes to the OS default and breaks the row's alignment.
      className="h-8 cursor-pointer appearance-none rounded-md border border-hairline bg-surface bg-[length:10px] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-8 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent focus:text-accent"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239DC8FF' stroke-width='1.5'/%3E%3C/svg%3E\")"
      }}
    >
      {QUEUE_FILTER_OPTIONS.map((option) => (
        <option
          key={option.label}
          value={option.value === null ? 'all' : String(option.value)}
          className="bg-surface text-text"
        >
          {option.label}
        </option>
      ))}
    </select>
  )
}
