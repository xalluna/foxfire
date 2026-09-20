import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ServerState } from '@shared/types'

/**
 * Tracks whether Riot has rejected the stored key. Personal keys expire every
 * 24h, so this is an expected state rather than an exceptional one.
 *
 * Seeded from stored state as well as the event, because the app now syncs at
 * launch: the rejection arrives within a few hundred milliseconds of the window
 * being created, well before this effect has subscribed, and an event fired at
 * nobody left the user with an app that silently fetched nothing.
 *
 * Dismissing clears only the local flag; the read below reasserts it on the
 * next settings fetch until a working key is saved, which is the point — the
 * banner should not be permanently dismissable while the key is still dead.
 */
/**
 * Whether this window is reading from a server, and whether that server's Riot
 * key still works.
 *
 * Both come from the same place because they are the same question asked twice:
 * a key problem means something different depending on whose key it is, and
 * there is nothing on this machine to fix when it is the host's.
 */
export function useServerHealth(): { connected: boolean; riotKeyRejected: boolean } {
  const [state, setState] = useState<ServerState | null>(null)

  useEffect(() => {
    void window.api.server.getState().then(setState)
    return window.api.server.onChanged(setState)
  }, [])

  return {
    connected: state?.activeUrl != null && state.session != null,
    riotKeyRejected: state?.riotKeyRejected === true
  }
}

export function useKeyRejected(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(false)
  const [rejected, setRejected] = useState(false)
  const queryClient = useQueryClient()

  const stored = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get()
  })

  useEffect(() => {
    return window.api.settings.onKeyInvalid(() => {
      setRejected(true)
      setDismissed(false)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    })
  }, [queryClient])

  const active = (rejected || stored.data?.keyRejected === true) && !dismissed

  return [
    active,
    () => {
      setDismissed(true)
      setRejected(false)
    }
  ]
}
