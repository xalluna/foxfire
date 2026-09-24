import { useEffect, useReducer } from 'react'
import { secondsUntil } from '../lib/cooldown'

/**
 * Seconds left until `until`, re-rendering as each one passes and stopping at
 * zero.
 *
 * Read against the clock on every render rather than a time held in state, so
 * a wait that arrives on a button mounted minutes ago is right the moment it
 * arrives. The timer only asks for the next render, on the whole-second
 * boundary, so the number changes when a second actually ends and the button
 * comes back when it should rather than up to a second late. Held by whatever
 * shows the number, so only that re-renders.
 */
export function useCountdown(until: string | null): number {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const seconds = secondsUntil(until, Date.now())

  // Re-armed after every render rather than on a dependency list: a timer that
  // fired a hair early would leave the number unchanged, and a list keyed on it
  // would never schedule the next one.
  useEffect(() => {
    if (until === null || seconds === 0) return
    const remaining = Date.parse(until) - Date.now()
    const timer = setTimeout(tick, remaining % 1000 || 1000)
    return () => clearTimeout(timer)
  })

  return seconds
}
