import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Segmented, SettingsCard, SettingsPage, SettingsRow } from '@foxfire/ui'
import { DEFAULT_ZOOM, ZOOM_STEPS, zoomLabel } from '@shared/display'
import type { DisplaySettings as Display } from '@shared/types'

const KEY = ['display']

/**
 * How large this PC draws Foxfire.
 *
 * One size for every window, remembered across restarts, and the same one the
 * zoom keys move — so the page listens for a change as well as making one: a
 * Ctrl+= in the recording window should move the selection here too.
 */
export function DisplaySettings(): JSX.Element {
  const queryClient = useQueryClient()

  const display = useQuery({
    queryKey: KEY,
    queryFn: () => window.api.display.get()
  })

  useEffect(
    () => window.api.display.onChanged((next) => queryClient.setQueryData<Display>(KEY, next)),
    [queryClient]
  )

  const update = useMutation({
    mutationFn: (zoom: number) => window.api.display.set({ zoom }),
    onSuccess: (next) => queryClient.setQueryData<Display>(KEY, next)
  })

  const zoom = display.data?.zoom ?? DEFAULT_ZOOM

  return (
    <SettingsPage title="Display">
      <SettingsCard>
        <SettingsRow
          label="Interface size"
          description="Text and layout grow together, in every Foxfire window, and stay that way after a restart. Ctrl + = and Ctrl + − change it from anywhere in the app, and Ctrl + 0 puts it back to 100%."
          control={
            <Segmented
              options={ZOOM_STEPS.map((step) => [String(step), zoomLabel(step)] as [string, string])}
              value={String(zoom)}
              onChange={(value) => update.mutate(Number(value))}
            />
          }
        />
      </SettingsCard>
    </SettingsPage>
  )
}
