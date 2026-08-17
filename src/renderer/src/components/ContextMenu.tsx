import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

export interface ContextMenuItem {
  label: string
  onSelect?: () => void
  /**
   * Why the item cannot be used. Present means disabled — shown rather than
   * hidden, because "why does this row have no LP?" is the question the menu
   * most often has to answer.
   */
  disabledReason?: string
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

const MENU_WIDTH = 210
/** Enough for the tallest item, label plus its reason on a second line. */
const ITEM_HEIGHT = 30
const EDGE_GAP = 8

/**
 * A themed right-click menu, portalled to the body.
 *
 * Hand-built rather than Electron's native Menu.popup(): this app draws its own
 * title bar and lives entirely in a dark gold-trimmed palette, and a grey
 * Windows menu in the middle of it reads as another application's. The cost is
 * having to do what the OS does for free — dismissal, Escape, and staying on
 * screen near an edge — which is what the rest of this file is.
 */
export function ContextMenu({
  state,
  onClose
}: {
  state: ContextMenuState | null
  onClose: () => void
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  // Measured after paint rather than estimated: an item's reason wraps to a
  // second line, so the height is not known until it is rendered.
  useLayoutEffect(() => {
    if (!state) return
    const height = ref.current?.offsetHeight ?? state.items.length * ITEM_HEIGHT
    const width = ref.current?.offsetWidth ?? MENU_WIDTH

    setPosition({
      x: Math.min(state.x, window.innerWidth - width - EDGE_GAP),
      y: Math.min(state.y, window.innerHeight - height - EDGE_GAP)
    })
  }, [state])

  useEffect(() => {
    if (!state) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // Capture, so a click landing on a button underneath closes the menu before
    // that button acts on it.
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onClose)
    // Scrolling the list out from under an anchored menu leaves it pointing at
    // nothing, so close instead of trying to follow the row.
    window.addEventListener('scroll', onClose, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [state, onClose])

  if (!state) return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: position.x, top: position.y, minWidth: MENU_WIDTH }}
      className="animate-flyout-in fixed z-50 overflow-hidden rounded-md border border-hairline bg-surface py-1 shadow-flyout"
    >
      {state.items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          disabled={item.disabledReason !== undefined}
          onClick={() => {
            onClose()
            item.onSelect?.()
          }}
          className={clsx(
            'block w-full px-3 py-1.5 text-left text-2xs transition',
            item.disabledReason === undefined
              ? 'text-text-dim hover:bg-gold/10 hover:text-gold'
              : 'cursor-not-allowed text-text-mute'
          )}
        >
          {item.label}
          {item.disabledReason !== undefined && (
            <span className="mt-0.5 block text-2xs leading-snug text-text-mute/70">
              {item.disabledReason}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body
  )
}
