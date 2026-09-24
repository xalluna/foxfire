import { useEffect, useState } from 'react'

/**
 * A value that stops changing until it has been still for a moment.
 *
 * For the search boxes that ask a server as somebody types: a request per
 * keystroke would spend a name's worth of requests on one name.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])

  return settled
}
