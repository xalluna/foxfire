import { useEffect, useState } from 'react'

/**
 * How long a search box waits before asking.
 *
 * A request per keystroke would spend a name's worth of the server's
 * per-address search allowance on one name. Long enough to swallow a typed
 * word, short enough not to feel like waiting.
 */
export const TYPING_PAUSE_MS = 250

/**
 * A value that stops changing until it has been still for a moment.
 *
 * For the search boxes that ask a server as somebody types — the header's, and
 * the admin pages' filters.
 */
export function useDebounced<T>(value: T, ms: number = TYPING_PAUSE_MS): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])

  return settled
}
