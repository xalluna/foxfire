import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import clsx from 'clsx'
import { CAPTURE_QUEUE_GROUPS } from '@shared/captureQueues'
import { CAPTURE_QUALITY_OPTIONS, type CaptureQualityOption } from '@shared/captureQuality'
import { SettingsCard, SettingsPage, ByteCapRow, PathRow, SettingsBlock, Stat, StatRow, StatusRow, ToggleRow, checkboxClass, ghostButtonClass, inputClass, primaryButtonClass, selectClass, Icon } from '@foxfire/ui'
import type {
  CaptureAudio,
  CaptureDriver,
  CaptureQuality,
  CaptureSettings as Settings,
  CaptureStatus,
  NativeCaptureCheck,
  NativeEncoder,
  ObsMode
} from '@shared/types'

/**
 * Recording setup.
 *
 * Two recorders, because the two audiences want opposite things. Somebody who
 * has never opened OBS wants recording to just work, and the native recorder
 * needs nothing installed: it captures the game's own window with the FFmpeg
 * the app ships. Somebody who already streams may want OBS doing it, set up
 * their way — and OBS itself has two modes for the same reason. Managed mode
 * builds a profile and scene collection of its own and sets the container,
 * folder and audio inside them, so nothing they configured is touched; manual
 * mode only ever reads their setup and reports what would stop a recording
 * playing.
 *
 * The preview is the point of the manual path: seeing the frame OBS would
 * capture is the difference between finding out now and finding out after a
 * game you wanted to keep.
 *
 * By far the longest page in Settings, so it is the one that most needs its
 * cards: the recorder, which games, quality and storage are separate questions
 * and undivided rows made them look like one.
 */
const PREVIEW_MS = 1500

const AUDIO_LABELS: Record<CaptureAudio, string> = {
  none: 'No audio',
  game: 'Game audio',
  'game+mic': 'Game audio and microphone'
}

const ENCODER_LABELS: Record<NativeEncoder, string> = {
  nvenc: 'NVIDIA NVENC',
  amf: 'AMD AMF',
  qsv: 'Intel Quick Sync',
  'mf-hw': 'Windows Media Foundation, on the GPU',
  mf: 'Windows Media Foundation, on the CPU'
}

/** The recorder cannot be switched under a game it is recording. */
function busy(status: CaptureStatus | undefined): boolean {
  return status?.state === 'armed' || status?.state === 'recording'
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

  const usesObs = settings.data?.driver === 'obs'

  const validation = useQuery({
    queryKey: ['captureValidation'],
    queryFn: () => window.api.capture.validate(),
    enabled: settings.data?.enabled === true && usesObs,
    refetchInterval: 10_000
  })

  const usage = useQuery({
    queryKey: ['recordingUsage'],
    queryFn: () => window.api.recordings.usage()
  })

  const preview = useQuery({
    queryKey: ['capturePreview'],
    queryFn: () => window.api.capture.preview(),
    enabled: showPreview && settings.data?.enabled === true && usesObs,
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
  const driver: CaptureDriver = current?.driver ?? 'native'
  // Recordings outlive the switch that made them, so the figures stay on the
  // page after capture is turned off — that is exactly when someone comes here
  // looking for what is still taking up the drive.
  const hasRecordings = usage.data !== undefined && usage.data.count > 0
  // Quality and audio are the app's to set when it owns the recording: always
  // natively, and in OBS only in the profile managed mode builds.
  const ownsOutput = driver === 'native' || current?.mode === 'managed'

  return (
    <SettingsPage
      title="Game capture"
      intro={
        <>
          Records your games while you play, and marks the timeline with your kills, deaths and
          multikills so you can jump straight to the fight. Foxfire records by itself, or through
          OBS if you would rather it did.
        </>
      }
    >
      <SettingsCard>
        <StatusRow tone={statusTone(status.data?.state)}>
          {statusMessage(status.data, driver)}
        </StatusRow>

        <ToggleRow
          label="Record my games"
          description={
            driver === 'obs'
              ? 'Starts OBS with the app and records whenever a game in an enabled queue begins.'
              : 'Records whenever a game in an enabled queue begins.'
          }
          checked={enabled}
          disabled={disabled}
          onChange={(next) => update.mutate({ enabled: next })}
        />
      </SettingsCard>

      {enabled && current && (
        <>
          <SettingsCard title="Recorder">
            <RecorderPicker
              driver={driver}
              disabled={disabled || busy(status.data)}
              locked={busy(status.data)}
              onChange={(next) => update.mutate({ driver: next })}
            />
          </SettingsCard>

          {driver === 'native' && <NativeCaptureCard />}

          {driver === 'obs' && (
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
          )}

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
              driver={driver}
              applies={ownsOutput}
              disabled={disabled}
              onChange={(quality) => update.mutate({ quality })}
            />

            <AudioPicker
              value={current.audio}
              driver={driver}
              applies={ownsOutput}
              audioInputs={validation.data?.audioInputs ?? []}
              disabled={disabled}
              onChange={(audio) => update.mutate({ audio })}
            />

            {driver === 'native' && current.audio === 'game+mic' && (
              <MicrophonePicker
                value={current.micDeviceId}
                disabled={disabled}
                onChange={(micDeviceId) => update.mutate({ micDeviceId })}
              />
            )}
          </SettingsCard>
        </>
      )}

      {(enabled || hasRecordings) && (
        <SettingsCard title="Storage">
          {enabled && current && (
            <PathRow
              label="Recording folder"
              description="Where recordings are written, each filed by player, game and mode — Faker-KR1\TFT\Ranked. Pick a drive with room — a 30 minute game is a gigabyte or two."
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

function statusMessage(status: { state: string; message?: string } | undefined, driver: CaptureDriver): string {
  if (!status) return 'Checking…'
  switch (status.state) {
    case 'off':
      return 'Not recording'
    case 'connecting':
      return driver === 'obs' ? 'Connecting to OBS…' : 'Getting ready to record…'
    case 'idle':
      return driver === 'obs' ? 'Connected to OBS — waiting for a game' : 'Ready — waiting for a game'
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

/** Two or three side-by-side choices, each with the sentence that decides it. */
function ChoiceCards<T extends string>({
  label,
  description,
  value,
  options,
  disabled,
  onChange
}: {
  label: string
  description?: string
  value: T
  options: Array<{ value: T; label: string; hint: string }>
  disabled: boolean
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <SettingsBlock label={label} description={description}>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-md border p-3 text-left transition disabled:cursor-not-allowed',
              value === option.value
                ? 'border-accent-dim bg-accent/10'
                : 'border-hairline bg-surface-2 hover:border-accent-dim/50'
            )}
          >
            <span
              className={clsx('block text-sm', value === option.value ? 'text-accent' : 'text-text')}
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

function RecorderPicker({
  driver,
  disabled,
  locked,
  onChange
}: {
  driver: CaptureDriver
  disabled: boolean
  /** A game is being recorded, which is why the choice cannot change now. */
  locked: boolean
  onChange: (driver: CaptureDriver) => void
}): JSX.Element {
  return (
    <ChoiceCards
      label="What records the video"
      description={locked ? 'Can be changed once this game is over.' : undefined}
      value={driver}
      disabled={disabled}
      onChange={onChange}
      options={[
        {
          value: 'native',
          label: 'Foxfire',
          hint: 'Nothing to install. Records the game’s own window, so whatever you open on top of it never shows up.'
        },
        {
          value: 'obs',
          label: 'OBS',
          hint: 'For an OBS you already use. Foxfire starts it and tells it when to record.'
        }
      ]}
    />
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
  return (
    <ChoiceCards
      label="How OBS is set up"
      value={mode}
      disabled={disabled}
      onChange={onChange}
      options={[
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
      ]}
    />
  )
}

/**
 * The native recorder: whether it can record on this PC, and with what.
 *
 * Asked fresh on opening — the check opens every encoder in turn — because this
 * page is where somebody comes after updating a GPU driver to see if it helped.
 */
/** The native recorder's check, asked once and shared by the card and the quality picker. */
function useNativeCheck(enabled = true): UseQueryResult<NativeCaptureCheck> {
  return useQuery({
    queryKey: ['captureNative'],
    queryFn: () => window.api.capture.nativeCheck(),
    staleTime: Infinity,
    retry: false,
    enabled
  })
}

function NativeCaptureCard(): JSX.Element {
  const queryClient = useQueryClient()
  const check = useNativeCheck()

  return (
    <SettingsCard title="Foxfire capture">
      <StatusRow tone={check.data ? nativeTone(check.data) : 'mute'}>
        {check.isFetching ? 'Checking this PC’s video encoders…' : describeNativeCheck(check.data)}
      </StatusRow>

      <SettingsBlock
        label="Game window"
        description="League and TFT are recorded from their own windows. Whatever you alt-tab to, or open on top of the game, never shows up in the recording."
      >
        <button
          type="button"
          disabled={check.isFetching}
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['captureNative'] })}
          className={ghostButtonClass}
        >
          Check encoders again
        </button>
      </SettingsBlock>
    </SettingsCard>
  )
}

function nativeTone(check: NativeCaptureCheck): 'good' | 'warn' {
  return check.ffmpeg === 'ok' && check.encoder !== null ? 'good' : 'warn'
}

function describeNativeCheck(check: NativeCaptureCheck | undefined): string {
  if (!check) return 'Could not check this PC.'
  if (check.ffmpeg === 'missing') return 'FFmpeg is missing from this install. Reinstall Foxfire to record without OBS.'
  if (check.ffmpeg === 'tooOld') return `This FFmpeg (${check.version ?? 'unknown'}) is too old to capture a window.`
  if (check.encoder === null) {
    return 'No video encoder worked on this PC. Updating the graphics driver usually fixes this — or use OBS.'
  }
  return `Recording with ${ENCODER_LABELS[check.encoder]}`
}

/**
 * Which microphone the native recorder mixes in. The list comes from the same
 * hidden page that records it, so the ids always mean the same device.
 */
function MicrophonePicker({
  value,
  disabled,
  onChange
}: {
  value: string | null
  disabled: boolean
  onChange: (deviceId: string | null) => void
}): JSX.Element {
  const microphones = useQuery({
    queryKey: ['captureMicrophones'],
    queryFn: () => window.api.capture.listMicrophones()
  })
  const list = microphones.data ?? []
  // A device that was chosen and has since been unplugged is still shown, so
  // the setting does not silently read as the default.
  const missing = value !== null && microphones.data !== undefined && !list.some((mic) => mic.deviceId === value)

  return (
    <SettingsBlock label="Microphone">
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        aria-label="Microphone"
        className={clsx(selectClass, 'w-full')}
      >
        <option value="">Windows default microphone</option>
        {list.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label}
          </option>
        ))}
        {missing && <option value={value}>Not connected</option>}
      </select>
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
      description="The scene that captures the game. League and TFT are separate programs — League of Legends.exe and TFTClient-Win64-Shipping.exe — so a scene for both needs a game capture of each. It is switched to when recording starts."
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
  const box = (option: { value: number; label: string }): JSX.Element => (
    <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        disabled={disabled}
        checked={queues.includes(option.value)}
        onChange={(event) =>
          onChange({
            queues: event.target.checked ? [...queues, option.value] : queues.filter((id) => id !== option.value)
          })
        }
        className={checkboxClass}
      />
      <span className="text-text-dim">{option.label}</span>
    </label>
  )

  // A group per game. League's ends with its catch-all for modes nobody
  // listed; TFT's queues are listed and start unticked, and nothing records
  // TFT that is not ticked here.
  return (
    <SettingsBlock>
      {CAPTURE_QUEUE_GROUPS.map((group) => (
        <div key={group.game} className="mb-3 last:mb-0">
          <p className="mb-1.5 text-2xs uppercase tracking-widest text-text-mute">{group.label}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {group.options.map(box)}
            {group.game === 'lol' && (
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
            )}
          </div>
        </div>
      ))}
      <p className="mt-2.5 text-2xs leading-relaxed text-text-mute">
        “Other” covers League’s customs, Practice Tool and whatever rotating mode is running, so a
        new gamemode is not silently missed. It never overrides a queue you unticked above, and it
        does not record TFT.
      </p>
    </SettingsBlock>
  )
}

/**
 * What the native recorder and managed OBS record at.
 *
 * Resolution and frame rate are the two things that decide how hard the encoder
 * works, so this is the control that matters on a machine already struggling to
 * hold frames in game — turning it down costs picture and buys performance.
 *
 * Disabled in OBS's manual mode for the same reason the audio choice is: those
 * settings live in a profile the user built, and this app does not rewrite it.
 */
function QualityPicker({
  value,
  driver,
  applies,
  disabled,
  onChange
}: {
  value: CaptureQuality
  driver: CaptureDriver
  /** Whether the app sets the output — false only for OBS in manual mode. */
  applies: boolean
  disabled: boolean
  onChange: (quality: CaptureQuality) => void
}): JSX.Element {
  const managed = applies
  const chosen = CAPTURE_QUALITY_OPTIONS.find((option) => option.value === value)
  // What "your refresh rate" is, so the option can say it.
  const displayHz = useNativeCheck(driver === 'native').data?.displayHz ?? null

  const label = (option: CaptureQualityOption): string => {
    if (option.fps !== 'display') return `${option.label} — about ${option.approxGbPerHour} GB per hour`
    const rate = displayHz ? `${option.height}p ${displayHz}fps, your refresh rate` : option.label
    if (driver === 'obs') return `${rate} — Foxfire's recorder only`
    return `${rate} — about ${option.approxGbPerHour} GB per hour at 144 Hz`
  }

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
          <option
            key={option.value}
            value={option.value}
            // OBS takes one fixed frame rate; it records these at 60.
            disabled={option.nativeOnly === true && driver === 'obs' && option.value !== value}
          >
            {label(option)}
          </option>
        ))}
      </select>

      {managed && chosen && (
        <p className="mt-2 text-2xs leading-relaxed text-text-mute">
          {chosen.nativeOnly && driver === 'obs'
            ? `OBS records this at ${chosen.height}p 60fps — following the display is Foxfire's recorder's alone.`
            : chosen.hint}
        </p>
      )}
    </SettingsBlock>
  )
}

function AudioPicker({
  value,
  driver,
  applies,
  audioInputs,
  disabled,
  onChange
}: {
  value: CaptureAudio
  driver: CaptureDriver
  /** Whether the app sets the output — false only for OBS in manual mode. */
  applies: boolean
  audioInputs: Array<{ name: string; muted: boolean }>
  disabled: boolean
  onChange: (audio: CaptureAudio) => void
}): JSX.Element {
  const managed = applies

  return (
    <SettingsBlock
      label="Audio"
      description={
        driver === 'native'
          ? 'Game audio is everything the PC plays — voice chat and music included, not just the game.'
          : managed
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
                : 'No frame yet. Check OBS is running and the scene above is the one that captures the game.'}
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
      return 'Pick the scene that captures the game.'
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
