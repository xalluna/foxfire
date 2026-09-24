import clsx from 'clsx'

/**
 * The app's segmented-toggle idiom.
 *
 * Lives here rather than beside one of its callers because the Rank and
 * Champions screens both build a period picker out of it, and the two have to
 * look identical — a period control that renders differently on each screen
 * reads as two unrelated features.
 *
 * `sm` is for a card in the profile's 320px rail, where the page-sized control
 * leaves no room beside it; `stretch` shares the width out between the options.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  stretch = false
}: {
  options: Array<[T, string]>
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  stretch?: boolean
}): JSX.Element {
  return (
    <div
      className={clsx(
        'flex overflow-hidden rounded-md border border-hairline',
        size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm'
      )}
    >
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={clsx(
            'whitespace-nowrap transition',
            size === 'sm' ? 'px-2.5' : 'px-3',
            stretch && 'flex-1',
            value === key ? 'bg-accent/10 text-accent' : 'text-text-dim hover:bg-surface'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
