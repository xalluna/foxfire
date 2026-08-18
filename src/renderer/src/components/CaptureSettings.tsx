import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CAPTURE_QUEUE_OPTIONS } from '@shared/queues'
import { Toggle } from './Toggle'
import * as Icon from './icons'
import type { CaptureAudio, CaptureSettings as Settings, ObsMode } from '@shared/types'

/**
 * Recording setup.
 *
 * Two modes, because the two audiences want opposite things. Somebody who has
 * never opened OBS wants it to just work, so managed mode builds a profile and
 * scene collection of its own and sets the container, folder and audio inside
 * them — nothing they configured is touched because there is nothing of theirs
 * in there. Somebody who already streams has a setup they care about, so manual
 * mode only ever reads it and reports what would stop a recording playing.
 *
 * The preview is the point of the manual path: seeing the frame OBS would
 * capture is the difference between finding out now and finding out after a
 * game you wanted to keep.
 */
const PREVIEW_MS = 1500

const AUDIO_LABELS: Record<CaptureAudio, string> = {
  none: 'No audio',
  game: 'Game audio',
  'game+mic': 'Game audio and microphone'
}

const GB = 1024 * 1024 * 1024

function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

export function CaptureSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const [showPreview, setShowPreview] = useState(false)

  const settings = useQuery({
    queryKey: ['capture'],
    queryFn: () => window.api.capture.getSettings()
  })

  const status = useQuery({
    queryKey: ['captureStatus'],
    queryFn: () => window.api.capture.getStatus(),
    refetchInterval: 5_000
  })

  const validation = useQuery({
    queryKey: ['captureValidation'],
    queryFn: () => window.api.capture.validate(),
    enabled: settings.data?.enabled === true,
    refetchInterval: 10_000
  })

  const usage = useQuery({
    queryKey: ['replayUsage'],
    queryFn: () => window.api.replays.usage()
  })

  const preview = useQuery({
    queryKey: ['capturePreview'],
    queryFn: () => window.api.capture.preview(),
    enabled: showPreview && settings.data?.enabled === true,
    refetchInterval: PREVIEW_MS,
    // A frame that failed to arrive is not worth an error state; the next poll
    // is a second and a half away.
    retry: false
  })

  const update = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.api.capture.set(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(['capture'], next)
      queryClient.invalidateQueries({ queryKey: ['captureValidation'] })
      queryClient.invalidateQueries({ queryKey: ['captureStatus'] })
    }
  })

  const current = settings.data
  const disabled = !current || update.isPending

  return (
    <section className="rounded-lg border border-hairline bg-surface p-5">
      <div className="flex items-center gap-2">
        <Icon.Film className="text-gold" />
        <h2 className="font-display text-lg text-text">Game capture</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-dim">
        Records your games through OBS while you play, and marks the timeline with your kills,
        deaths and multikills so you can jump straight to the fight. OBS has to be installed —
        this app drives it rather than encoding video itself.
      </p>

      <CaptureStatusPill state={status.data?.state} message={statusMessage(status.data)} />

      <div className="mt-4 space-y-3">
        <Toggle
          label="Record my games"
          description="Starts OBS with the app and records whenever a game in an enabled queue begins."
          checked={current?.enabled ?? false}
          disabled={disabled}
          onChange={(enabled) => update.mutate({ enabled })}
        />

        {current?.enabled && (
          <>
            <ModePicker
              mode={current.mode}
              disabled={disabled}
              onChange={(mode) => update.mutate({ mode })}
            />

            {validation.data && !validation.data.ok && (
              <ul className="space-y-1.5 rounded-md border border-amber/30 bg-amber/10 p-3">
                {validation.data.problems.map((problem) => (
                  <li key={problem.kind} className="flex gap-2 text-2xs leading-relaxed text-amber">
                    <Icon.Warning className="mt-px shrink-0" width={12} height={12} />
                    <span>{describeProblem(problem)}</span>
                  </li>
                ))}
              </ul>
            )}

            {current.mode === 'manual' && (
              <ScenePicker
                scenes={validation.data?.scenes ?? []}
                value={current.obsScene}
                disabled={disabled}
                onChange={(obsScene) => update.mutate({ obsScene })}
              />
            )}

            <PathRow
              label="Replay folder"
              hint="Where recordings are written. Pick a drive with room — a 30 minute game is a gigabyte or two."
              value={current.folder}
              disabled={disabled}
              onBrowse={async () => {
                const folder = await window.api.capture.chooseFolder()
                if (folder) update.mutate({ folder })
              }}
            />

            <PathRow
              label="OBS install"
              hint="Only needed if OBS is somewhere unusual — the standard install locations are found automatically."
              value={current.obsInstallPath}
              placeholder="Detected automatically"
              disabled={disabled}
              onBrowse={async () => {
                const obsInstallPath = await window.api.capture.chooseObsPath()
                if (obsInstallPath) update.mutate({ obsInstallPath })
              }}
            />

            <ObsPassword hasPassword={current.hasObsPassword} disabled={disabled} />

            <QueuePicker
              queues={current.queues}
              otherQueues={current.otherQueues}
              disabled={disabled}
              onChange={(patch) => update.mutate(patch)}
            />

            <AudioPicker
              value={current.audio}
              mode={current.mode}
              audioInputs={validation.data?.audioInputs ?? []}
              disabled={disabled}
              onChange={(audio) => update.mutate({ audio })}
            />

            <SoftCap
              value={current.softCapBytes}
              disabled={disabled}
              onChange={(softCapBytes) => update.mutate({ softCapBytes })}
            />

            <Preview
              open={showPreview}
              frame={preview.data ?? null}
              managed={current.mode === 'managed'}
              onToggle={() => setShowPreview(!showPreview)}
            />
          </>
        )}
      </div>

      {usage.data && usage.data.count > 0 && (
        <DiskUsage
          totalBytes={usage.data.totalBytes}
          count={usage.data.count}
          unmatchedCount={usage.data.unmatchedCount}
          softCapBytes={current?.softCapBytes ?? 0}
        />
      )}
    </section>
  )
}

function statusMessage(status: { state: string; message?: string } | undefined): string {
  if (!status) return 'Checking…'
  switch (status.state) {
    case 'off':
      return 'Not recording'
    case 'connecting':
      return 'Connecting to OBS…'
    case 'idle':
      return 'Connected to OBS — waiting for a game'
    case 'armed':
      return 'Game detected — waiting for it to load'
    case 'recording':
      return 'Recording'
    default:
      return status.message ?? 'Something is wrong'
  }
}

function CaptureStatusPill({
  state,
  message
}: {
  state: string | undefined
  message: string
}): JSX.Element {
  const tone =
    state === 'recording'
      ? 'border-red/30 bg-red/10 text-red'
      : state === 'idle'
        ? 'border-teal/30 bg-teal/10 text-teal'
        : state === 'error'
          ? 'border-amber/30 bg-amber/10 text-amber'
          : 'border-hairline bg-canvas text-text-mute'

  return (
    <div
      className={clsx(
        'mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-2xs',
        tone
      )}
    >
      {state === 'recording' ? <Icon.Record width={10} height={10} /> : null}
      {message}
    </div>
  )
}

function ModePicker({
  mode,
  disabled,
  onChange
}: {
  mode: ObsMode
  disabled: boolean
  onChange: (mode: ObsMode) => void
}): JSX.Element {
  const options: Array<{ value: ObsMode; label: string; hint: string }> = [
    {
      value: 'managed',
      label: 'Set OBS up for me',
      hint: 'Creates its own OBS profile and scene collection and switches into them while recording. Your own OBS setup is never modified.'
    },
    {
      value: 'manual',
      label: 'Use my own scene',
      hint: 'Records with a scene you built. Nothing in it is changed — problems are reported instead.'
    }
  ]

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-md border p-3 text-left transition',
            mode === option.value
              ? 'border-gold-dim bg-gold/10'
              : 'border-hairline bg-canvas hover:border-gold-dim/50'
          )}
        >
          <span
            className={clsx('block text-sm', mode === option.value ? 'text-gold' : 'text-text')}
          >
            {option.label}
          </span>
          <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
            {option.hint}
          </span>
        </button>
      ))}
    </div>
  )
}

function ScenePicker({
  scenes,
  value,
  disabled,
  onChange
}: {
  scenes: string[]
  value: string | null
  disabled: boolean
  onChange: (scene: string) => void
}): JSX.Element {
  return (
    <label className="block rounded-md border border-hairline bg-canvas p-3">
      <span className="block text-sm text-text">Scene</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
        The scene that captures League. It is switched to when recording starts.
      </span>
      <select
        value={value ?? ''}
        disabled={disabled || scenes.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-8 w-full rounded-md border border-hairline bg-surface px-2 text-sm text-text focus:border-gold-dim focus:outline-none"
      >
        <option value="" disabled>
          {scenes.length === 0 ? 'Connect to OBS to list scenes' : 'Choose a scene…'}
        </option>
        {scenes.map((scene) => (
          <option key={scene} value={scene}>
            {scene}
          </option>
        ))}
      </select>
    </label>
  )
}

function PathRow({
  label,
  hint,
  value,
  placeholder,
  disabled,
  onBrowse
}: {
  label: string
  hint: string
  value: string | null
  placeholder?: string
  disabled: boolean
  onBrowse: () => void
}): JSX.Element {
  return (
    <div className="rounded-md border border-hairline bg-canvas p-3">
      <span className="block text-sm text-text">{label}</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">{hint}</span>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={value ?? ''}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-text-dim placeholder:text-text-mute"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onBrowse}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-gold-dim bg-gold/10 px-3 text-sm font-medium text-gold transition hover:bg-gold/20 disabled:opacity-50"
        >
          <Icon.Folder width={13} height={13} />
          Browse
        </button>
      </div>
    </div>
  )
}

/**
 * The obs-websocket password, handled the way the Riot key is: write-only.
 *
 * It is stored encrypted next to the Riot key rather than in the database, and
 * never comes back across IPC — only whether one is set.
 */
function ObsPassword({
  hasPassword,
  disabled
}: {
  hasPassword: boolean
  disabled: boolean
}): JSX.Element {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')

  const save = useMutation({
    mutationFn: (password: string) => window.api.capture.setObsPassword(password),
    onSuccess: (next) => {
      setDraft('')
      queryClient.setQueryData(['capture'], next)
    }
  })

  const clear = useMutation({
    mutationFn: () => window.api.capture.clearObsPassword(),
    onSuccess: (next) => queryClient.setQueryData(['capture'], next)
  })

  return (
    <div className="rounded-md border border-hairline bg-canvas p-3">
      <span className="block text-sm text-text">OBS websocket password</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
        From OBS under Tools → WebSocket Server Settings. Stored encrypted, and never shown again.
      </span>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.trim()) save.mutate(draft)
        }}
      >
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={hasPassword ? '••••••••  (saved)' : 'Leave blank if authentication is off'}
          className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-mute focus:border-gold-dim focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="shrink-0 rounded-md border border-gold-dim bg-gold/10 px-3 text-sm font-medium text-gold transition hover:bg-gold/20 disabled:opacity-50"
        >
          Save
        </button>
      </form>
      {hasPassword && (
        <button
          type="button"
          onClick={() => clear.mutate()}
          className="mt-2 text-2xs text-text-mute underline underline-offset-2 hover:text-red"
        >
          Remove saved password
        </button>
      )}
    </div>
  )
}

function QueuePicker({
  queues,
  otherQueues,
  disabled,
  onChange
}: {
  queues: number[]
  otherQueues: boolean
  disabled: boolean
  onChange: (patch: Partial<Settings>) => void
}): JSX.Element {
  return (
    <div className="rounded-md border border-hairline bg-canvas p-3">
      <span className="block text-sm text-text">Queues to record</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
        Everything else is left alone. Nothing is recorded unless it is ticked here.
      </span>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {CAPTURE_QUEUE_OPTIONS.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={disabled}
              checked={queues.includes(option.value)}
              onChange={(event) =>
                onChange({
                  queues: event.target.checked
                    ? [...queues, option.value]
                    : queues.filter((id) => id !== option.value)
                })
              }
              className="h-4 w-4 accent-gold"
            />
            <span className="text-text-dim">{option.label}</span>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            checked={otherQueues}
            onChange={(event) => onChange({ otherQueues: event.target.checked })}
            className="h-4 w-4 accent-gold"
          />
          <span className="text-text-dim">Other and rotating modes</span>
        </label>
      </div>
      <p className="mt-2 text-2xs leading-relaxed text-text-mute">
        “Other” covers customs, Practice Tool and whatever rotating mode is running, so a new
        gamemode is not silently missed. It never overrides a queue you unticked above.
      </p>
    </div>
  )
}

function AudioPicker({
  value,
  mode,
  audioInputs,
  disabled,
  onChange
}: {
  value: CaptureAudio
  mode: ObsMode
  audioInputs: Array<{ name: string; muted: boolean }>
  disabled: boolean
  onChange: (audio: CaptureAudio) => void
}): JSX.Element {
  const managed = mode === 'managed'

  return (
    <div className="rounded-md border border-hairline bg-canvas p-3">
      <span className="block text-sm text-text">Audio</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
        {managed
          ? 'Applied to the audio sources this app created.'
          : 'Your scene decides this. Changing it here would mean muting inputs this app does not own — and leaving your microphone muted if something went wrong.'}
      </span>

      <select
        value={value}
        disabled={disabled || !managed}
        onChange={(event) => onChange(event.target.value as CaptureAudio)}
        className="mt-2 h-8 w-full rounded-md border border-hairline bg-surface px-2 text-sm text-text focus:border-gold-dim focus:outline-none disabled:opacity-50"
      >
        {(Object.keys(AUDIO_LABELS) as CaptureAudio[]).map((option) => (
          <option key={option} value={option}>
            {AUDIO_LABELS[option]}
          </option>
        ))}
      </select>

      {!managed && audioInputs.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {audioInputs.map((input) => (
            <li key={input.name} className="flex items-center gap-1.5 text-2xs text-text-mute">
              {input.muted ? (
                <Icon.VolumeOff width={11} height={11} />
              ) : (
                <Icon.Volume width={11} height={11} className="text-teal" />
              )}
              {input.name}
              <span>{input.muted ? '— muted' : '— will be recorded'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SoftCap({
  value,
  disabled,
  onChange
}: {
  value: number
  disabled: boolean
  onChange: (bytes: number) => void
}): JSX.Element {
  return (
    <label className="block rounded-md border border-hairline bg-canvas p-3">
      <span className="block text-sm text-text">Warn me past</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
        A reminder, not a limit. Recordings are never deleted automatically — crossing this only
        shows a warning with a one-click cleanup.
      </span>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={2000}
          disabled={disabled}
          value={Math.round(value / GB)}
          onChange={(event) => onChange(Math.max(1, Number(event.target.value)) * GB)}
          className="w-24 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm tabular-nums text-text focus:border-gold-dim focus:outline-none"
        />
        <span className="text-sm text-text-dim">GB</span>
      </div>
    </label>
  )
}

function Preview({
  open,
  frame,
  managed,
  onToggle
}: {
  open: boolean
  frame: string | null
  managed: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="rounded-md border border-hairline bg-canvas p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-sm text-text">Preview</span>
          <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
            A live frame of what would be recorded, straight from OBS.
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-gold-dim hover:text-gold"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <div className="mt-3 overflow-hidden rounded border border-hairline bg-surface-2">
          {frame ? (
            <img src={frame} alt="What OBS would capture" className="w-full" />
          ) : (
            <p className="p-6 text-center text-2xs leading-relaxed text-text-mute">
              {managed
                ? 'The capture source is created the first time a game is recorded, so there is nothing to preview yet.'
                : 'No frame yet. Check OBS is running and the scene above is the one that captures League.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DiskUsage({
  totalBytes,
  count,
  unmatchedCount,
  softCapBytes
}: {
  totalBytes: number
  count: number
  unmatchedCount: number
  softCapBytes: number
}): JSX.Element {
  const over = softCapBytes > 0 && totalBytes > softCapBytes

  return (
    <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
      <Stat label="On disk" value={formatBytes(totalBytes)} warn={over} />
      <Stat label="Recordings" value={String(count)} />
      <Stat label="Unmatched" value={String(unmatchedCount)} />
    </dl>
  )
}

function Stat({
  label,
  value,
  warn
}: {
  label: string
  value: string
  warn?: boolean
}): JSX.Element {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-widest text-text-mute">{label}</dt>
      <dd
        className={clsx(
          'mt-1 font-display text-lg tabular-nums',
          warn ? 'text-amber' : 'text-text'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Copy for each validation problem.
 *
 * Duplicated from the main process's describeObsProblem rather than sent over
 * IPC: the problems are a typed union, so the compiler catches a missing case
 * here, and the strings stay where the rest of the UI copy lives.
 */
function describeProblem(problem: { kind: string; [key: string]: unknown }): string {
  switch (problem.kind) {
    case 'notConnected':
      return 'Not connected to OBS. Check it is running, and that Tools → WebSocket Server Settings has the server enabled.'
    case 'noFolder':
      return 'Choose a folder for recordings.'
    case 'recordFormat':
      return `OBS is recording as ${String(problem.found)}. Set Settings → Output → Recording Format to MP4 — MKV records fine but cannot be played back here.`
    case 'sceneNotChosen':
      return 'Pick the scene that captures League.'
    case 'sceneMissing':
      return `The scene "${String(problem.scene)}" no longer exists in OBS.`
    case 'noCaptureSource':
      return `"${String(problem.scene)}" has no game, window or display capture source, so it would record nothing.`
    case 'recordDirectory':
      return `OBS is saving to ${String(problem.found)}. Point Settings → Output → Recording Path at ${String(problem.expected)}.`
    default:
      return 'Something about the OBS setup is wrong.'
  }
}
