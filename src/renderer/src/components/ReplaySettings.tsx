import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsSection, SectionSummary } from './SettingsSection'
import { Toggle } from './Toggle'
import * as Icon from './icons'
import type { RoflSettings } from '@shared/types'

/**
 * Riot replays, and the clients that can play them back.
 *
 * The section has one job beyond the usual switches: telling the user when the
 * League client is not saving replays at all. That setting lives inside League,
 * defaults differently across accounts, and when it is off every part of
 * Foxfire behaves correctly while the tab stays permanently empty. It is the
 * only silent failure this feature has, so it is stated first and plainly.
 */
const GB = 1024 * 1024 * 1024

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
    <SettingsSection
      icon={<Icon.Film className="shrink-0 text-accent" />}
      title="Riot replays"
      summary={summaryFor(current)}
      blurb="Keep the .rofl files League saves, and watch them back in the client."
    >
      <p className="text-2xs leading-relaxed text-text-mute">
        A Riot replay is the game itself, not a video of your screen — every player&rsquo;s point of
        view and a free camera. Foxfire copies the files League writes so they survive, then hands
        them back to the client to play. It never plays them itself, and never changes anything in
        Riot&rsquo;s own folder.
      </p>

      {current?.autoRecordEnabled === false && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/10 p-4">
          <Icon.Warning className="mt-0.5 shrink-0 text-amber" />
          <div>
            <p className="text-sm text-amber">League is not saving replays.</p>
            <p className="mt-1 text-2xs leading-relaxed text-text-dim">
              There is nothing for Foxfire to pick up until you turn it on: in the League client, go
              to Settings &rarr; Replays and enable recording. Foxfire will not change this for you.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Toggle
          checked={current?.enabled ?? true}
          disabled={save.isPending}
          onChange={(enabled) => save.mutate({ enabled })}
          label="Keep Riot replays"
          description="Copies each .rofl out of League's folder so it survives being cleaned up."
        />

        <PathRow
          label="League's replay folder"
          value={current?.resolvedSourceFolder ?? null}
          hint={
            current?.sourceFolder === null
              ? 'Read from the League client. Override it only if Foxfire is watching the wrong place.'
              : 'Set by hand.'
          }
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
          value={current?.folder ?? null}
          hint="A Replays folder beside your recordings, so both follow the same drive."
          onBrowse={null}
          onClear={null}
        />

        <SoftCap
          bytes={current?.softCapBytes ?? 0}
          onChange={(softCapBytes) => save.mutate({ softCapBytes })}
        />

        <div className="border-t border-hairline pt-4">
          <p className="text-sm text-text">Older patches</p>
          <p className="mt-1 text-2xs leading-relaxed text-text-mute">
            A replay only runs on the patch that recorded it, and League keeps just one install. To
            watch older replays you need older game files — point Foxfire at any you have kept.
          </p>
          <button
            type="button"
            onClick={() => void window.api.archives.openWindow()}
            className="mt-3 rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent"
          >
            Manage archived clients…
          </button>
        </div>
      </div>
    </SettingsSection>
  )
}

/** The one fact worth seeing while the section is folded. */
function summaryFor(settings: RoflSettings | undefined): JSX.Element | null {
  if (settings === undefined) return null
  if (!settings.enabled) return <SectionSummary tone="mute">Off</SectionSummary>
  if (settings.autoRecordEnabled === false) {
    return <SectionSummary tone="warn">League is not saving replays</SectionSummary>
  }
  return <SectionSummary tone="good">On</SectionSummary>
}

function PathRow({
  label,
  value,
  hint,
  onBrowse,
  onClear
}: {
  label: string
  value: string | null
  hint: string
  onBrowse: (() => void) | null
  onClear: (() => void) | null
}): JSX.Element {
  return (
    <div>
      <p className="text-sm text-text">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          readOnly
          value={value ?? 'Not found'}
          className="min-w-0 flex-1 truncate rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-2xs text-text-dim"
        />
        {onBrowse !== null && (
          <button
            type="button"
            onClick={onBrowse}
            className="shrink-0 rounded-md border border-hairline px-2.5 py-1.5 text-2xs text-text-dim transition hover:border-accent-dim hover:text-accent"
          >
            Browse
          </button>
        )}
        {onClear !== null && (
          <button
            type="button"
            onClick={onClear}
            title="Go back to whatever the League client reports"
            className="shrink-0 rounded-md border border-hairline px-2.5 py-1.5 text-2xs text-text-dim transition hover:border-accent-dim hover:text-accent"
          >
            Reset
          </button>
        )}
      </div>
      <p className="mt-1 text-2xs text-text-mute">{hint}</p>
    </div>
  )
}

function SoftCap({
  bytes,
  onChange
}: {
  bytes: number
  onChange: (bytes: number) => void
}): JSX.Element {
  return (
    <div>
      <p className="text-sm text-text">Warn me past</p>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={Math.round(bytes / GB)}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value)) * GB)}
          className="w-20 rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm tabular-nums text-text"
        />
        <span className="text-2xs text-text-dim">GB of replays</span>
      </div>
      <p className="mt-1 text-2xs text-text-mute">
        A reminder, not a limit. Replays are never deleted automatically. A .rofl is usually 10&ndash;20 MB,
        so this is a few hundred games.
      </p>
    </div>
  )
}
