/**
 * Inline icon set. Hand-rolled rather than pulled from a library to keep the
 * dependency list short — every glyph is a 16x16 stroked path on a 24 viewBox
 * using currentColor, so Hextech tokens style them with no extra plumbing.
 *
 * Replaces the literal ▾ ★ ✕ characters the UI used before, which rendered
 * inconsistently across fonts.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  )
}

export function ChevronDown(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

/**
 * Gold marker. The only filled glyph here, and deliberately so.
 *
 * It sits beside 10px numbers in the scoreboard, where a 2px stroke on a 24
 * grid scales down to a grey smudge — no more readable than the literal "g"
 * this replaces, which ran together with the "k" and read as kilograms. A solid
 * disc holds its shape at that size. Still currentColor, so `text-gold` drives it.
 */
export function Coin(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <circle cx="12" cy="12" r="6" />
    </Icon>
  )
}

export function Star({ filled, ...props }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <Icon fill={filled ? 'currentColor' : 'none'} {...props}>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 9.4l6.1-.9z" />
    </Icon>
  )
}

export function TrendingUp(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Icon>
  )
}

export function Close(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  )
}

export function Sync(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </Icon>
  )
}

export function Search(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  )
}

export function Settings(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </Icon>
  )
}

/**
 * Broadcast mark: a broken ring around a filled dot.
 *
 * The dot takes its own optional colour so the two can disagree — a game in
 * progress rings it in teal, and recording turns the dot red inside that ring,
 * which reads as "live, and being kept" in one glyph.
 */
export function Live({
  dotClassName,
  ...props
}: IconProps & { dotClassName?: string }): JSX.Element {
  return (
    <Icon {...props}>
      <circle
        cx="12"
        cy="12"
        r="3.5"
        // currentColor resolves per element, so a text-* class here overrides
        // the colour the ring inherits without touching the ring.
        fill="currentColor"
        stroke="none"
        className={dotClassName}
      />
      <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 17.7a8 8 0 0 0 0-11.4" />
    </Icon>
  )
}

export function Plus(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function Warning(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Icon>
  )
}

export function Check(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  )
}

export function Dashboard(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </Icon>
  )
}

export function Trophy(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 4h12v5a6 6 0 0 1-12 0z" />
      <path d="M6 6H4a2 2 0 0 0 2 2M18 6h2a2 2 0 0 1-2 2" />
      <path d="M12 15v3M9 21h6" />
    </Icon>
  )
}

export function Swords(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M14.5 14.5 21 21M3 3l6.5 6.5M18 3h3v3l-9.5 9.5-3-3z" />
      <path d="M6 3H3v3l9.5 9.5M6.5 17.5 3 21M17.5 17.5 21 21" />
    </Icon>
  )
}

export function Inbox(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2 3h6l2-3h4" />
      <path d="M5.4 5.1 3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6l-2.4-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.9 1.1z" />
    </Icon>
  )
}

export function Key(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 8.3-8.3M17 6l2.5 2.5M14 9l2.5 2.5" />
    </Icon>
  )
}

export function Activity(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 12h3.5l2.5-7 4 14 2.5-7H21" />
    </Icon>
  )
}

/**
 * A death on the replay timeline.
 *
 * Filled rather than stroked, like Coin and for the same reason: these render
 * at 10px on a seek bar where a 2px stroke on a 24 grid turns to mush.
 */
export function Skull(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M12 2a8 8 0 0 0-5 14.3V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2.7A8 8 0 0 0 12 2Zm-3 9a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Zm6 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" />
    </Icon>
  )
}

export function Play(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M7 4.5v15l13-7.5z" />
    </Icon>
  )
}

export function Pause(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />
    </Icon>
  )
}

export function SkipBack(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M18 5v14L8 12zM6 5h2.2v14H6z" />
    </Icon>
  )
}

export function SkipForward(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M6 5v14l10-7zM15.8 5H18v14h-2.2z" />
    </Icon>
  )
}

/** The recording dot, used on the capture status pill. */
export function Record(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <circle cx="12" cy="12" r="6" />
    </Icon>
  )
}

export function Film(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 12h18" />
    </Icon>
  )
}

export function Folder(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  )
}

export function Trash(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Icon>
  )
}

export function Volume(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    </Icon>
  )
}

export function VolumeOff(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="m17 9 4 6M21 9l-4 6" />
    </Icon>
  )
}

export function Maximize(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
    </Icon>
  )
}

/** Leave fullscreen. The counterpart to Maximize, arrows pointing inward. */
export function Minimize(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M9 4v4H5M15 4v4h4M9 20v-4H5M15 20v-4h4" />
    </Icon>
  )
}
