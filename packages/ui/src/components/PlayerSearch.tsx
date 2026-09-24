import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import type { PlayerSearchResult } from '@foxfire/core'
import { useAssetManifest } from '../context/assetManifest'
import { profileIconUrl } from '../lib/assets'
import { isSearchShortcut, moveHighlight } from '../lib/combobox'
import { tierCrest, tierLabel } from '../lib/rank'
import { Asset } from './Asset'
import * as Icon from './icons'

/** One headed run of rows in the list: favorites, your accounts, or what a search found. */
export interface PlayerSearchSection {
  key: string
  /** Null for a list that needs no heading — the results of what was typed. */
  label: string | null
  players: readonly PlayerSearchResult[]
  /** Said in place of the rows when there are none. */
  empty?: string
  loading?: boolean
}

export interface PlayerSearchProps {
  query: string
  onQueryChange: (query: string) => void
  sections: readonly PlayerSearchSection[]
  /** A line above the list — a hint, "Searching…", or that nobody matched. Read out when it changes. */
  status?: string | null
  /** Something that did not work, like a star a full list refused. */
  notice?: string | null
  isFavorite: (accountId: string) => boolean
  /** Absent where there is nobody to star, and then no row has a star. */
  onToggleFavorite?: (player: PlayerSearchResult) => void
  /** A row was chosen. The box closes; clearing the query is the caller's. */
  onPick: (player: PlayerSearchResult) => void
  /**
   * Enter with no row highlighted: the caller says who that means, once it
   * knows — suggestions for what was typed may still be on their way.
   */
  onSubmit: () => PlayerSearchResult | null | Promise<PlayerSearchResult | null>
  /** The list opened. For fetching what it opens on only when somebody looks. */
  onOpen?: () => void
  /** The shortcut's label, "Ctrl K" or "⌘K". Given, the shortcut is listened for. */
  shortcut?: string
  placeholder?: string
  className?: string
}

/** Wide enough for a Riot ID, a rank and a star on one line, whatever the box shrank to. */
const LIST_MIN_WIDTH = 352
const EDGE_GAP = 8

/**
 * The player search box in the header, and the list that drops from it.
 *
 * An ARIA combobox, hand-built for the same reason the context menu is: the
 * package has no headless-UI dependency and one control does not justify one.
 * Focus never leaves the input while the list is open — rows and the stars on
 * them cancel their mousedown — so the arrows, Enter and Escape always reach
 * it, and a click on a row lands on the row rather than blurring the box shut
 * underneath it.
 *
 * The star on a row is deliberately out of the tab order and hidden from
 * assistive tech: a button inside an option is not something a combobox can
 * describe. Whether a row is starred is in its name instead, and the profile
 * has a star that is an ordinary button.
 *
 * The list is positioned absolutely rather than fixed: the web header blurs
 * what is behind it, and a backdrop filter makes a fixed child relative to the
 * header rather than to the window.
 */
export function PlayerSearch({
  query,
  onQueryChange,
  sections,
  status,
  notice,
  isFavorite,
  onToggleFavorite,
  onPick,
  onSubmit,
  onOpen,
  shortcut,
  placeholder = 'Search players',
  className
}: PlayerSearchProps): JSX.Element {
  const baseId = useId()
  const listId = `${baseId}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null)

  const rows = sections.flatMap((section) =>
    section.loading ? [] : section.players.map((player) => ({ section: section.key, player }))
  )
  const optionId = (at: number) => `${baseId}-${rows[at].section}-${rows[at].player.account.id}`
  const active = highlight !== null && highlight < rows.length ? highlight : null

  const visible = open && (sections.length > 0 || Boolean(status) || Boolean(notice))

  // A new query is a new list; a highlight from the last one points at nobody.
  useEffect(() => setHighlight(null), [query])

  useEffect(() => {
    if (open) onOpen?.()
    // Only on opening: onOpen is a fresh function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (active === null) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!shortcut) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!isSearchShortcut(event)) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcut])

  // Centred under the box, at least wide enough for a row, and kept on screen:
  // the box can be narrower than its list, and sits in the middle of a header
  // that can be narrower than both.
  useLayoutEffect(() => {
    if (!visible) return
    const measure = (): void => {
      const box = wrapperRef.current?.getBoundingClientRect()
      if (!box) return
      // The page's width without its scrollbar, which innerWidth counts.
      const viewport = document.documentElement.clientWidth
      const width = Math.min(Math.max(box.width, LIST_MIN_WIDTH), viewport - 2 * EDGE_GAP)
      const centred = box.left + (box.width - width) / 2
      const left = Math.min(Math.max(centred, EDGE_GAP), viewport - EDGE_GAP - width)
      setPlace({ left: left - box.left, width })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [visible])

  function pick(player: PlayerSearchResult): void {
    setOpen(false)
    inputRef.current?.blur()
    onPick(player)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // Enter and the arrows belong to an input method while it is composing.
    if (event.nativeEvent.isComposing) return

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (!open) {
          setOpen(true)
          return
        }
        setHighlight(moveHighlight(active, event.key === 'ArrowDown' ? 1 : -1, rows.length))
        return
      }
      case 'Enter': {
        event.preventDefault()
        if (active !== null) {
          pick(rows[active].player)
          return
        }
        void Promise.resolve(onSubmit()).then((player) => {
          if (player) pick(player)
        })
        return
      }
      case 'Escape': {
        event.preventDefault()
        if (open) setOpen(false)
        else if (query) onQueryChange('')
        else inputRef.current?.blur()
        return
      }
      case 'Tab':
        setOpen(false)
    }
  }

  return (
    <div ref={wrapperRef} className={clsx('relative', className)}>
      <Icon.Search
        width={14}
        height={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-mute"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search players"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={active !== null ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          onQueryChange(event.target.value)
          setOpen(true)
        }}
        onMouseDown={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className="h-7 w-full rounded-md border border-hairline bg-surface-2 pl-8 pr-14 text-sm text-text transition placeholder:text-text-mute focus:border-accent-dim focus:outline-none"
      />

      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onQueryChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-mute transition hover:text-text"
        >
          <Icon.Close width={12} height={12} />
        </button>
      ) : (
        shortcut && (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-hairline px-1 font-sans text-2xs text-text-mute max-sm:hidden">
            {shortcut}
          </kbd>
        )
      )}

      {visible && (
        <div
          // Anything inside the list keeps focus in the box, headings and gaps included.
          onMouseDown={(event) => event.preventDefault()}
          style={place ? { left: place.left, width: place.width } : { left: 0, minWidth: LIST_MIN_WIDTH }}
          className="animate-flyout-in absolute top-full z-50 mt-1.5 overflow-hidden rounded-md border border-hairline bg-surface shadow-flyout"
        >
          {notice && (
            <p role="alert" className="border-b border-hairline px-3 py-2 text-2xs text-amber">
              {notice}
            </p>
          )}
          <p role="status" className={clsx('px-3 text-2xs text-text-mute', status && 'py-2')}>
            {status}
          </p>

          <div id={listId} role="listbox" aria-label="Players" className="max-h-[min(70vh,28rem)] overflow-y-auto pb-1">
            {sections.map((section) => {
              const headingId = `${baseId}-${section.key}-heading`
              return (
                <div
                  key={section.key}
                  role="group"
                  aria-labelledby={section.label ? headingId : undefined}
                  aria-label={section.label ? undefined : 'Suggestions'}
                >
                  {section.label && (
                    <p
                      id={headingId}
                      className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-widest text-text-mute"
                    >
                      {section.label}
                    </p>
                  )}
                  {section.loading ? (
                    <p className="px-3 py-1.5 text-2xs text-text-mute">Loading…</p>
                  ) : section.players.length === 0 ? (
                    section.empty && <p className="px-3 py-1.5 text-2xs text-text-mute">{section.empty}</p>
                  ) : (
                    section.players.map((player) => {
                      const at = rows.findIndex(
                        (row) => row.section === section.key && row.player.account.id === player.account.id
                      )
                      return (
                        <PlayerOption
                          key={player.account.id}
                          id={optionId(at)}
                          player={player}
                          highlighted={at === active}
                          starred={isFavorite(player.account.id)}
                          onHover={() => setHighlight(at)}
                          onPick={() => pick(player)}
                          onToggleFavorite={onToggleFavorite && (() => onToggleFavorite(player))}
                        />
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PlayerOption({
  id,
  player,
  highlighted,
  starred,
  onHover,
  onPick,
  onToggleFavorite
}: {
  id: string
  player: PlayerSearchResult
  highlighted: boolean
  starred: boolean
  onHover: () => void
  onPick: () => void
  onToggleFavorite?: () => void
}): JSX.Element {
  const assets = useAssetManifest()
  const { account } = player

  return (
    <div
      id={id}
      role="option"
      aria-selected={highlighted}
      aria-label={`${account.gameName}#${account.tagLine}${starred ? ', favorite' : ''}`}
      onMouseMove={highlighted ? undefined : onHover}
      onClick={onPick}
      className={clsx(
        'flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors',
        highlighted && 'bg-accent/15'
      )}
    >
      <Asset
        src={assets ? profileIconUrl(assets, account.profileIconId) : null}
        className="h-7 w-7 border border-hairline"
        rounded="rounded"
      />
      <span className={clsx('min-w-0 flex-1 truncate text-sm', highlighted ? 'text-accent' : 'text-text')}>
        {account.gameName}
        <span className="text-text-mute">#{account.tagLine}</span>
      </span>
      <RankChip entry={player.soloEntry} />
      {onToggleFavorite && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          title={starred ? 'Remove from favorites' : 'Add to favorites'}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite()
          }}
          className={clsx(
            'shrink-0 rounded p-1 transition hover:bg-surface-2',
            starred ? 'text-accent' : 'text-text-mute hover:text-accent'
          )}
        >
          <Icon.Star width={14} height={14} filled={starred} />
        </button>
      )}
    </div>
  )
}

/** Solo-queue standing, or nothing at all for somebody unplaced. */
function RankChip({ entry }: { entry: PlayerSearchResult['soloEntry'] }): JSX.Element | null {
  if (!entry || entry.tier === null) return null

  const crest = tierCrest(entry.tier)

  return (
    <span className="flex shrink-0 items-center gap-1 text-2xs text-text-dim">
      {crest && <img src={crest} alt="" className="h-4 w-4" />}
      <span className="whitespace-nowrap">
        {tierLabel(entry.tier, entry.rank)}
        {entry.leaguePoints !== null && <span className="text-text-mute"> · {entry.leaguePoints} LP</span>}
      </span>
    </span>
  )
}
