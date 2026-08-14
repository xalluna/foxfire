import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Tracks whether Riot has rejected the stored key. Personal keys expire every
 * 24h, so this is an expected state rather than an exceptional one.
 */
export function useKeyRejected(): [boolean, () => void] {
  const [rejected, setRejected] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    return window.api.settings.onKeyInvalid(() => {
      setRejected(true)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    })
  }, [queryClient])

  return [rejected, () => setRejected(false)]
}
