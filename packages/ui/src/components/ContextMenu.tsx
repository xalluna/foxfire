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
 * having to do what the OS does for free — dismissal, Escape, staying on
 * screen near an edge, and the keyboard — which is what the rest of this file
 * is.
 *
 * The keyboard's part is a menu's usual one. Focus moves into the menu when it
 * opens, wherever it was opened from — the menu key and Shift+F10 open it on
 * the focused row — and the arrow keys walk it. Escape and Tab close it and
 * put focus back on what opened it, as choosing an item does; a click
 * somewhere else leaves focus where that click put it. A disabled item can
 * still be walked to, so its reason is read out, but not chosen.
 */
export function ContextMenu({
  state,
  onClose
}: {
  state: ContextMenuState | null
  onClose: () => void
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
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

  // Into the menu as it opens, remembering where focus came from. A pointer
  // that opened it gets no ring for this: focus moved by a script after a
  // click does not count as keyboard focus.
  useEffect(() => {
    if (!state) return
    const focused = document.activeElement
    if (!ref.current?.contains(focused)) opener.current = focused instanceof HTMLElement ? focused : null
    const items = menuItems(ref.current)
    const first = items.find((item) => item.getAttribute('aria-disabled') !== 'true') ?? items[0]
    first?.focus({ preventScroll: true })
  }, [state])

  // Closing by the keyboard or by choosing hands focus back to the row the
  // menu was about, so the next key press carries on from there.
  const closeAndReturn = (): void => {
    onClose()
    opener.current?.focus()
  }

  useEffect(() => {
    if (!state) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault()
        onClose()
        opener.current?.focus()
      }
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
      onKeyDown={(event) => {
        const items = menuItems(ref.current)
        const at = items.indexOf(document.activeElement as HTMLElement)
        const to =
          event.key === 'ArrowDown'
            ? (at + 1) % items.length
            : event.key === 'ArrowUp'
              ? (at - 1 + items.length) % items.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : null
        if (to === null) return
        event.preventDefault()
        items[to]?.focus()
      }}
    >
      {state.items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          tabIndex={-1}
          aria-disabled={item.disabledReason !== undefined || undefined}
          onClick={() => {
            if (item.disabledReason !== undefined) return
            closeAndReturn()
            item.onSelect?.()
          }}
          className={clsx(
            // The menu clips to its corners, so the focus ring goes inside.
            'block w-full px-3 py-1.5 text-left text-xs transition focus-visible:outline-offset-[-2px]',
            item.disabledReason === undefined
              ? 'text-text-dim hover:bg-accent/10 hover:text-accent'
              : 'cursor-not-allowed text-text-mute'
          )}
        >
          {item.label}
          {item.disabledReason !== undefined && (
            <span className="mt-0.5 block text-xs leading-snug text-text-mute">
              {item.disabledReason}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body
  )
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}
