import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CAPTURE_QUEUE_OPTIONS } from '@shared/captureQueues'
import { CAPTURE_QUALITY_OPTIONS } from '@shared/captureQuality'
import { SettingsCard, SettingsPage } from './settings/SettingsCard'
import {
  ByteCapRow,
  PathRow,
  SettingsBlock,
  Stat,
  StatRow,
  StatusRow,
  ToggleRow
} from './settings/SettingsRow'
import {
  checkboxClass,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  selectClass
} from './settings/controls'
import * as Icon from './icons'
import type {
  CaptureAudio,
  CaptureQuality,
  CaptureSettings as Settings,
  ObsMode
} from '@shared/types'

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
 *
 * By far the longest page in Settings, so it is the one that most needs its
 * cards: OBS, which games, quality and storage are four separate questions and
 * fourteen undivided rows made them look like one.
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
    queryKey: ['recordingUsage'],
    queryFn: () => window.api.recordings.usage()
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
  const enabled = current?.enabled === true
  // Recordings outlive the switch that made them, so the figures stay on the
  // page after capture is turned off — that is exactly when someone comes here
  // looking for what is still taking up the drive.
  const hasRecordings = usage.data !== undefined && usage.data.count > 0

  return (
    <SettingsPage
      title="Game capture"
      intro={
        <>
          Records your games through OBS while you play, and marks the timeline with your kills,
          deaths and multikills so you can jump straight to the fight. OBS has to be installed — this
          app drives it rather than encoding video itself.
        </>
      }
    >
      <SettingsCard>
        <StatusRow tone={statusTone(status.data?.state)}>{statusMessage(status.data)}</StatusRow>

        <ToggleRow
          label="Record my games"
          description="Starts OBS with the app and records whenever a game in an enabled queue begins."
          checked={enabled}
          disabled={disabled}
          onChange={(next) => update.mutate({ enabled: next })}
        />
      </SettingsCard>

      {enabled && current && (
        <>
          <SettingsCard title="OBS">
            <ModePicker
              mode={current.mode}
              disabled={disabled}
              onChange={(mode) => update.mutate({ mode })}
            />

            {validation.data && !validation.data.ok && (
              <SettingsBlock className="bg-amber/10">
                <ul className="space-y-1.5">
                  {validation.data.problems.map((problem) => (
                    <li
                      key={problem.kind}
                      className="flex gap-2 text-2xs leading-relaxed text-amber"
                    >
                      <Icon.Warning className="mt-px shrink-0" width={12} height={12} />
                      <span>{describeProblem(problem)}</span>
                    </li>
                  ))}
                </ul>
              </SettingsBlock>
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
              label="OBS install"
              description="Only needed if OBS is somewhere unusual — the standard install locations are found automatically."
              value={current.obsInstallPath}
              placeholder="Detected automatically"
              disabled={disabled}
              onBrowse={async () => {
                const obsInstallPath = await window.api.capture.chooseObsPath()
                if (obsInstallPath) update.mutate({ obsInstallPath })
              }}
            />

            <ObsPassword hasPassword={current.hasObsPassword} disabled={disabled} />

            <Preview
              open={showPreview}
              frame={preview.data ?? null}
              managed={current.mode === 'managed'}
              onToggle={() => setShowPreview(!showPreview)}
            />
          </SettingsCard>

          <SettingsCard
            title="Which games to record"
            description="Everything else is left alone. Nothing is recorded unless it is ticked here."
          >
            <QueuePicker
              queues={current.queues}
              otherQueues={current.otherQueues}
              disabled={disabled}
              onChange={(patch) => update.mutate(patch)}
            />
          </SettingsCard>

          <SettingsCard title="Quality">
            <QualityPicker
              value={current.quality}
              mode={current.mode}
              disabled={disabled}
              onChange={(quality) => update.mutate({ quality })}
            />

            <AudioPicker
              value={current.audio}
              mode={current.mode}
              audioInputs={validation.data?.audioInputs ?? []}
              disabled={disabled}
              onChange={(audio) => update.mutate({ audio })}
            />
          </SettingsCard>
        </>
      )}

      {(enabled || hasRecordings) && (
        <SettingsCard title="Storage">
          {enabled && current && (
            <PathRow
              label="Recording folder"
              description="Where recordings are written. Pick a drive with room — a 30 minute game is a gigabyte or two."
              value={current.folder}
              disabled={disabled}
              onBrowse={async () => {
                const folder = await window.api.capture.chooseFolder()
                if (folder) update.mutate({ folder })
              }}
            />
          )}

          {enabled && current && (
            <ByteCapRow
              label="Warn me past"
              description="A reminder, not a limit. Recordings are never deleted automatically — crossing this only shows a warning with a one-click cleanup."
              bytes={current.softCapBytes}
              unit="GB"
              disabled={disabled}
              onChange={(softCapBytes) => update.mutate({ softCapBytes })}
            />
          )}

          {usage.data && hasRecordings && (
            <StatRow>
              <Stat
                label="On disk"
                value={formatBytes(usage.data.totalBytes)}
                tone={
                  (current?.softCapBytes ?? 0) > 0 &&
                  usage.data.totalBytes > (current?.softCapBytes ?? 0)
                    ? 'warn'
                    : 'normal'
                }
              />
              <Stat label="Recordings" value={String(usage.data.count)} />
              <Stat label="Unmatched" value={String(usage.data.unmatchedCount)} />
            </StatRow>
          )}
        </SettingsCard>
      )}
    </SettingsPage>
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

function statusTone(state: string | undefined): 'good' | 'mute' | 'warn' | 'recording' {
  if (state === 'recording') return 'recording'
  if (state === 'idle') return 'good'
  if (state === 'error') return 'warn'
  return 'mute'
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
    <SettingsBlock label="How OBS is set up">
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
                ? 'border-accent-dim bg-accent/10'
                : 'border-hairline bg-surface-2 hover:border-accent-dim/50'
            )}
          >
            <span
              className={clsx('block text-sm', mode === option.value ? 'text-accent' : 'text-text')}
            >
              {option.label}
            </span>
            <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
              {option.hint}
            </span>
          </button>
        ))}
      </div>
    </SettingsBlock>
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
    <SettingsBlock
      label="Scene"
      description="The scene that captures League. It is switched to when recording starts."
    >
      <select
        value={value ?? ''}
        disabled={disabled || scenes.length === 0}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Scene"
        className={clsx(selectClass, 'w-full')}
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
    </SettingsBlock>
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
    <SettingsBlock
      label="OBS websocket password"
      description="From OBS under Tools → WebSocket Server Settings. Stored encrypted, and never shown again."
    >
      <form
        className="flex gap-2"
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
          aria-label="OBS websocket password"
          placeholder={hasPassword ? '••••••••  (saved)' : 'Leave blank if authentication is off'}
          className={clsx(inputClass, 'flex-1')}
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className={primaryButtonClass}
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
    </SettingsBlock>
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
    <SettingsBlock>
      <div className="grid gap-1.5 sm:grid-cols-2">
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
              className={checkboxClass}
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
            className={checkboxClass}
          />
          <span className="text-text-dim">Other and rotating modes</span>
        </label>
      </div>
      <p className="mt-2.5 text-2xs leading-relaxed text-text-mute">
        “Other” covers customs, Practice Tool and whatever rotating mode is running, so a new
        gamemode is not silently missed. It never overrides a queue you unticked above.
      </p>
    </SettingsBlock>
  )
}

/**
 * What managed mode records at.
 *
 * Resolution and frame rate are the two things that decide how hard the encoder
 * works, so this is the control that matters on a machine already struggling to
 * hold frames in game — turning it down costs picture and buys performance.
 *
 * Disabled in manual mode for the same reason the audio choice is: those
 * settings live in a profile the user built, and this app does not rewrite it.
 */
function QualityPicker({
  value,
  mode,
  disabled,
  onChange
}: {
  value: CaptureQuality
  mode: ObsMode
  disabled: boolean
  onChange: (quality: CaptureQuality) => void
}): JSX.Element {
  const managed = mode === 'managed'
  const chosen = CAPTURE_QUALITY_OPTIONS.find((option) => option.value === value)

  return (
    <SettingsBlock
      label="Recording quality"
      description={
        managed
          ? 'Lower this if recording costs you frames in game. It changes what the encoder has to work on, not what you see while playing.'
          : 'Your own OBS profile decides this — Settings → Video in OBS.'
      }
    >
      <select
        value={value}
        disabled={disabled || !managed}
        onChange={(event) => onChange(event.target.value as CaptureQuality)}
        aria-label="Recording quality"
        className={clsx(selectClass, 'w-full')}
      >
        {CAPTURE_QUALITY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — about {option.approxGbPerHour} GB per hour
          </option>
        ))}
      </select>

      {managed && chosen && (
        <p className="mt-2 text-2xs leading-relaxed text-text-mute">{chosen.hint}</p>
      )}
    </SettingsBlock>
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
    <SettingsBlock
      label="Audio"
      description={
        managed
          ? 'Applied to the audio sources this app created.'
          : 'Your scene decides this. Changing it here would mean muting inputs this app does not own — and leaving your microphone muted if something went wrong.'
      }
    >
      <select
        value={value}
        disabled={disabled || !managed}
        onChange={(event) => onChange(event.target.value as CaptureAudio)}
        aria-label="Audio"
        className={clsx(selectClass, 'w-full')}
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
    </SettingsBlock>
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
    <SettingsBlock>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="block text-sm text-text">Preview</span>
          <span className="mt-0.5 block text-2xs leading-relaxed text-text-mute">
            A live frame of what would be recorded, straight from OBS.
          </span>
        </div>
        <button type="button" onClick={onToggle} className={ghostButtonClass}>
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
    </SettingsBlock>
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
