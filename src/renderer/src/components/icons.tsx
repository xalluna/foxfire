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

export function Star({ filled, ...props }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <Icon fill={filled ? 'currentColor' : 'none'} {...props}>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 9.4l6.1-.9z" />
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

export function Live(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
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
