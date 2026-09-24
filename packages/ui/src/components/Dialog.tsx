import { useEffect, useId, type ReactNode } from 'react'
import * as Icon from './icons'
import { dangerButtonClass, ghostButtonClass, primaryButtonClass } from './settings/controls'

/**
 * A small window over the page, for a question that needs an answer before
 * anything else happens.
 *
 * Escape and the backdrop both dismiss it, because there is never a case here
 * where walking away is not a valid answer. Nothing is decided on dismiss.
 */
export function Dialog({
  title,
  onClose,
  children,
  width = 'max-w-md'
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: string
}): JSX.Element {
  const titleId = useId()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${width} rounded-lg border border-hairline bg-surface shadow-flyout`}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <h2 id={titleId} className="font-display text-base text-text">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-text-mute transition hover:text-text"
          >
            <Icon.Close width={14} height={14} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

/** The row of buttons along the bottom of a dialog. */
export function DialogActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mt-5 flex items-center justify-end gap-2">{children}</div>
}

/**
 * "Are you sure?", for the few things here worth asking about.
 *
 * The message says what will and will not happen — "the video stays on
 * YouTube" — because a confirmation that only repeats the button's label is
 * one people learn to click through.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel
}: {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <Dialog title={title} onClose={onCancel}>
      <div className="text-sm leading-relaxed text-text-dim">{message}</div>
      {error && <p className="mt-3 text-sm text-red">{error}</p>}
      <DialogActions>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? dangerButtonClass : primaryButtonClass}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </DialogActions>
    </Dialog>
  )
}
