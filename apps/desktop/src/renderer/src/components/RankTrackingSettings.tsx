import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { BackgroundSettings } from '@shared/types'
import { useLcuStatus } from '../hooks/useLcuStatus'
import { SeasonsCard } from '@foxfire/screens'
import { SettingsCard, SettingsPage, SettingsBlock, StatusRow, ToggleRow, ghostButtonClass, inputClass } from '@foxfire/ui'

/**
 * Controls for the half of LP tracking that cannot work from the Riot API.
 *
 * Per-game LP is derived by reading rank from the running League client, which
 * means this app has to be running too. Both switches are off by default and
 * the copy is explicit about the trade-off, because an app that survives its
 * own close button or adds itself to Windows startup should never be a surprise.
 *
 * The ranked season dates live on this page too. They are what decides which
 * games belong to which season, so every number the rank history shows is
 * downstream of them — a separate top-level page for a table that exists to
 * serve this one was a fold-era arrangement.
 */
export function RankTrackingSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const status = useLcuStatus()
  const [pathDraft, setPathDraft] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['background'],
    queryFn: () => window.api.background.get()
  })

  const update = useMutation({
    mutationFn: (patch: Partial<BackgroundSettings>) => window.api.background.set(patch),
    onSuccess: (next) => queryClient.setQueryData(['background'], next)
  })

  const data = settings.data
  const storedPath = data?.lcuInstallPath ?? ''
  const path = pathDraft ?? storedPath

  return (
    <SettingsPage
      title="Rank tracking"
      intro={
        <>
          Riot publishes no per-game LP, so it has to be measured by watching your rank change around
          each game. That needs this app running while you play. With it off, rank is still recorded
          on every sync — you just get the total across several games instead of a figure per game.
        </>
      }
    >
      <SettingsCard>
        <StatusRow
          tone={
            status.state === 'connected' ? 'good' : status.state === 'untracked' ? 'warn' : 'mute'
          }
        >
          {status.state === 'connected' ? (
            <>
              Connected to the League client as {status.gameName}#{status.tagLine}
            </>
          ) : status.state === 'untracked' ? (
            <>
              {status.gameName}#{status.tagLine} is logged in but not tracked here. Link it under
              Settings → Server, or add it locally, to record its rank.
            </>
          ) : (
            <>League client not detected. Start it to capture per-game LP.</>
          )}
        </StatusRow>

        <ToggleRow
          label="Keep running in the tray"
          description="Closing the window hides it instead of quitting, so rank keeps being recorded while you play. Quit from the tray icon."
          checked={data?.runInTray ?? false}
          disabled={update.isPending || !data}
          onChange={(runInTray) => update.mutate({ runInTray })}
        />

        <ToggleRow
          label="Start with Windows"
          description="Launches hidden in the tray at sign-in. Only useful alongside the option above."
          checked={data?.launchAtStartup ?? false}
          disabled={update.isPending || !data || !data.runInTray}
          onChange={(launchAtStartup) => update.mutate({ launchAtStartup })}
        />

        <SettingsBlock
          label="League install path"
          description="Only needed if the client is not found automatically — leave blank otherwise."
        >
          <div className="flex gap-2">
            <input
              value={path}
              onChange={(e) => setPathDraft(e.target.value)}
              placeholder="C:\Riot Games\League of Legends"
              spellCheck={false}
              aria-label="League install path"
              className={clsx(inputClass, 'flex-1')}
            />
            <button
              onClick={() => {
                update.mutate({ lcuInstallPath: path })
                setPathDraft(null)
              }}
              disabled={update.isPending || path === storedPath}
              className={ghostButtonClass}
            >
              Save
            </button>
          </div>
        </SettingsBlock>
      </SettingsCard>

      <SeasonsCard />
    </SettingsPage>
  )
}
