import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RoflSettings } from '@shared/types'
import { SettingsCard, SettingsPage, ByteCapRow, LinkRow, PathRow, StatusRow, ToggleRow } from '@foxfire/ui'

/**
 * Riot replays, and the clients that can play them back.
 *
 * The page has one job beyond the usual switches: telling the user when the
 * League client is not saving replays at all. That setting lives inside League,
 * defaults differently across accounts, and when it is off every part of
 * Foxfire behaves correctly while the tab stays permanently empty. It is the
 * only silent failure this feature has, so it is stated first and plainly —
 * which is why it is the one thing on this page still allowed to shout in amber.
 */
export function ReplaySettings(): JSX.Element {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: ['roflSettings'],
    queryFn: () => window.api.replays.settings()
  })

  const save = useMutation({
    mutationFn: (patch: Partial<RoflSettings>) => window.api.replays.setSettings(patch),
    onSuccess: (next) => queryClient.setQueryData(['roflSettings'], next)
  })

  const current = settings.data

  return (
    <SettingsPage
      title="Riot replays"
      intro={
        <>
          A Riot replay is the game itself, not a video of your screen — every player&rsquo;s point
          of view and a free camera. Foxfire copies the files League writes so they survive, then
          hands them back to the client to play. It never plays them itself, and never changes
          anything in Riot&rsquo;s own folder.
        </>
      }
    >
      <SettingsCard>
        {current?.autoRecordEnabled === false && (
          <StatusRow tone="warn">
            League is not saving replays. There is nothing for Foxfire to pick up until you turn it
            on: in the League client, go to Settings &rarr; Replays and enable recording. Foxfire
            will not change this for you.
          </StatusRow>
        )}

        <ToggleRow
          label="Keep Riot replays"
          description="Copies each .rofl out of League's folder so it survives being cleaned up."
          checked={current?.enabled ?? true}
          disabled={save.isPending}
          onChange={(enabled) => save.mutate({ enabled })}
        />
      </SettingsCard>

      <SettingsCard title="Folders">
        <PathRow
          label="League's replay folder"
          description={
            current?.sourceFolder === null
              ? 'Read from the League client. Override it only if Foxfire is watching the wrong place.'
              : 'Set by hand.'
          }
          value={current?.resolvedSourceFolder ?? null}
          onBrowse={async () => {
            const folder = await window.api.replays.chooseSourceFolder()
            if (folder !== null) save.mutate({ sourceFolder: folder })
          }}
          onClear={
            current?.sourceFolder === null ? null : () => save.mutate({ sourceFolder: null })
          }
        />

        <PathRow
          label="Where Foxfire keeps its copies"
          description="A Replays folder beside your recordings, so both follow the same drive."
          value={current?.folder ?? null}
          onBrowse={null}
          onClear={null}
        />

        <ByteCapRow
          label="Warn me past"
          description="A reminder, not a limit. Replays are never deleted automatically. A .rofl is usually 10–20 MB, so this is a few hundred games."
          bytes={current?.softCapBytes ?? 0}
          unit="GB of replays"
          onChange={(softCapBytes) => save.mutate({ softCapBytes })}
        />
      </SettingsCard>

      <SettingsCard
        title="Older patches"
        description="A replay only runs on the patch that recorded it, and League keeps just one install. To watch older replays you need older game files — point Foxfire at any you have kept."
      >
        <LinkRow
          label="Manage archived clients"
          onClick={() => void window.api.archives.openWindow()}
        />
      </SettingsCard>
    </SettingsPage>
  )
}
