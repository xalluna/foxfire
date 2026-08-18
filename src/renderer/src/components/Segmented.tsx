import clsx from 'clsx'

/**
 * The app's segmented-toggle idiom.
 *
 * Lives here rather than beside one of its callers because the Rank and
 * Champions screens both build a period picker out of it, and the two have to
 * look identical — a period control that renders differently on each screen
 * reads as two unrelated features.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<[T, string]>
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex h-8 overflow-hidden rounded-md border border-hairline text-sm">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={clsx(
            'whitespace-nowrap px-3 transition',
            value === key ? 'bg-gold/10 text-gold' : 'text-text-dim hover:bg-surface'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
