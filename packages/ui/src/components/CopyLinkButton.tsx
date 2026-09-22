import { useEffect, useState } from 'react'
import clsx from 'clsx'
import * as Icon from './icons'

/**
 * "Copy link", and a moment of "Copied" afterwards.
 *
 * The confirmation is the whole of the feedback: nothing on screen changes
 * when a link lands on the clipboard, so without it the only way to know the
 * click worked is to paste somewhere and look.
 */
export function CopyLinkButton({
  onCopy,
  className
}: {
  onCopy: () => Promise<void> | void
  className?: string
}): JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      onClick={() => {
        void Promise.resolve(onCopy()).then(() => setCopied(true))
      }}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 text-2xs transition',
        copied ? 'border-teal/40 text-teal' : 'text-text-dim hover:border-accent-dim hover:text-accent',
        className
      )}
    >
      {copied ? <Icon.Check width={13} height={13} /> : <Icon.Link width={13} height={13} />}
      {copied ? 'Copied' : 'Copy link'}
    </button>
  )
}
