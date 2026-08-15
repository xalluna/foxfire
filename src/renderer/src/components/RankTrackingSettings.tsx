import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { BackgroundSettings } from '@shared/types'
import { useLcuStatus } from '../hooks/useLcuStatus'
import * as Icon from './icons'

/**
 * Controls for the half of LP tracking that cannot work from the Riot API.
 *
 * Per-game LP is derived by reading rank from the running League client, which
 * means this app has to be running too. Both switches are off by default and
 * the copy is explicit about the trade-off, because an app that survives its
 * own close button or adds itself to Windows startup should never be a surprise.
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
    <section className="rounded-lg border border-hairline bg-surface p-5">
      <div className="flex items-center gap-2">
        <Icon.TrendingUp className="text-gold" />
        <h2 className="font-display text-lg text-text">Rank tracking</h2>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-text-dim">
        Riot publishes no per-game LP, so it has to be measured by watching your rank change around
        each game. That needs this app running while you play. With it off, rank is still recorded
        on every sync — you just get the total across several games instead of a figure per game.
      </p>

      <div
        className={clsx(
          'mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
          status.state === 'connected'
            ? 'border-teal/30 bg-teal/10 text-teal'
            : status.state === 'untracked'
              ? 'border-amber/40 bg-amber/10 text-amber'
              : 'border-hairline bg-canvas text-text-mute'
        )}
      >
        {status.state === 'connected' ? (
          <>
            <Icon.Check width={14} height={14} />
            Connected to the League client as {status.gameName}#{status.tagLine}
          </>
        ) : status.state === 'untracked' ? (
          <>
            <Icon.Warning width={14} height={14} />
            {status.gameName}#{status.tagLine} is logged in but not tracked here — add the account
            to record its rank.
          </>
        ) : (
          <>
            <Icon.Warning width={14} height={14} />
            League client not detected. Start it to capture per-game LP.
          </>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <Toggle
          label="Keep running in the tray"
          description="Closing the window hides it instead of quitting, so rank keeps being recorded while you play. Quit from the tray icon."
          checked={data?.runInTray ?? false}
          disabled={update.isPending || !data}
          onChange={(runInTray) => update.mutate({ runInTray })}
        />

        <Toggle
          label="Start with Windows"
          description="Launches hidden in the tray at sign-in. Only useful alongside the option above."
          checked={data?.launchAtStartup ?? false}
          disabled={update.isPending || !data || !data.runInTray}
          onChange={(launchAtStartup) => update.mutate({ launchAtStartup })}
        />
      </div>

      <div className="mt-5">
        <label className="text-2xs font-medium uppercase tracking-widest text-text-mute">
          League install path
        </label>
        <p className="mt-1 text-sm text-text-dim">
          Only needed if the client is not found automatically — leave blank otherwise.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={path}
            onChange={(e) => setPathDraft(e.target.value)}
            placeholder="C:\Riot Games\League of Legends"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-text placeholder:text-text-mute focus:border-gold-dim focus:outline-none"
          />
          <button
            onClick={() => {
              update.mutate({ lcuInstallPath: path })
              setPathDraft(null)
            }}
            disabled={update.isPending || path === storedPath}
            className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-gold-dim hover:text-gold disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </section>
  )
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-start gap-3 rounded-md border border-hairline bg-canvas p-3',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
      />
      <span className="min-w-0">
        <span className="block text-sm text-text">{label}</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">{description}</span>
      </span>
    </label>
  )
}
