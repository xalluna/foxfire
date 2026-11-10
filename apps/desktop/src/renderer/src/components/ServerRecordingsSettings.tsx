import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_TFT_TITLE_TEMPLATE,
  DEFAULT_TITLE_TEMPLATE,
  TFT_TITLE_TOKENS,
  TITLE_TOKENS,
  renderRecordingTitle,
  renderTftRecordingTitle
} from '@foxfire/core/recordings'
import {
  SettingsBlock,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  StatusRow,
  ToggleRow,
  ghostButtonClass,
  inputClass,
  primaryButtonClass
} from '@foxfire/ui'
import { BulkUploadDialog } from '../media/BulkUploadDialog'
import { describeQueueHold, formatBytes, queueSummary } from '../media/uploadStatus'
import { useUploadQueue, useUploadServer } from '../media/useMedia'
import type { BulkUploadResult, MediaSettings } from '@shared/types'

/** A believable game to preview the title template against. */
const PREVIEW_FACTS = {
  champion: 'Ahri',
  queueId: 420,
  gameMode: 'CLASSIC',
  win: true,
  kills: 12,
  deaths: 3,
  assists: 8,
  playedAt: Date.now()
}

/** A believable TFT game for the TFT template's preview. */
const TFT_PREVIEW_FACTS = {
  queueId: 1100,
  placement: 2,
  teamPlacement: null,
  trait: 'Flora Fatalis',
  playedAt: Date.now()
}

/**
 * Sending recordings to the server.
 *
 * The server keeps them on its Foxfire Media, and everybody on it can watch —
 * with your kills and deaths marked on the timeline. This PC sends the file
 * straight there; the server only says it may. Uploads run in the background,
 * one at a time, pause while you are in a game, and pick up where they left
 * off after a restart.
 */
export function ServerRecordingsSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const server = useUploadServer()
  const queue = useUploadQueue()
  const settings = useQuery({ queryKey: ['mediaSettings'], queryFn: () => window.api.media.getSettings() })
  const backlog = useQuery({
    queryKey: ['recordings', 'backlog', server],
    queryFn: () => window.api.media.backlog(),
    enabled: server !== null
  })
  const [everything, setEverything] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (patch: Partial<MediaSettings>) => window.api.media.setSettings(patch),
    onSuccess: (next) => queryClient.setQueryData(['mediaSettings'], next)
  })

  const summary = queue ? queueSummary(queue) : null

  return (
    <SettingsPage
      title="Server recordings"
      intro={
        <>
          Sends your recordings to your Foxfire Server, so everybody on it can watch them — with your kills
          and deaths marked on the timeline. The file goes straight to the server&rsquo;s video storage, one
          at a time, in the background; uploads pause while you are in a game and carry on after a restart.
        </>
      }
    >
      <SettingsCard title="Uploads">
        {server === null ? (
          <StatusRow tone="mute">
            {queue?.held === 'no_recordings'
              ? 'The server this PC is signed in to does not keep recordings. Its host turns them on.'
              : 'Sign in to a Foxfire Server, in Settings › Server, to upload recordings to it.'}
          </StatusRow>
        ) : (
          queue?.held &&
          queue.held !== 'paused' && <StatusRow tone={queue.held === 'server_full' ? 'warn' : 'mute'}>{describeQueueHold(queue.held)}</StatusRow>
        )}

        {settings.data && (
          <>
            <ToggleRow
              label="Upload every game automatically"
              description="Once a recording finds its game, it goes to the server by itself, after the game is over — nothing to click. Off unless you turn it on."
              checked={settings.data.autoUpload}
              disabled={false}
              onChange={(autoUpload) => save.mutate({ autoUpload })}
            />

            <ToggleRow
              label="Delete the file from this PC once it is on the server"
              description="Only after the server says the video is ready to watch. The recording and its markers stay in your history, and play from the server. Applies to uploads queued from now on."
              checked={settings.data.afterUpload === 'delete'}
              disabled={false}
              onChange={(on) => save.mutate({ afterUpload: on ? 'delete' : 'keep' })}
            />
          </>
        )}

        <SettingsRow
          label={summary ?? (queue?.held === 'paused' ? 'Uploads are paused' : 'Nothing is uploading')}
          description="One recording at a time, oldest game first. Each row in Captures › Recordings says where its own upload is."
          control={
            queue && (queue.waiting > 0 || queue.held === 'paused') ? (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => void (queue.held === 'paused' ? window.api.media.resumeAll() : window.api.media.pauseAll())}
              >
                {queue.held === 'paused' ? 'Resume uploads' : 'Pause uploads'}
              </button>
            ) : undefined
          }
        />

        {server !== null && backlog.data && backlog.data.count > 0 && (
          <SettingsRow
            label={`${backlog.data.count} recording${backlog.data.count === 1 ? '' : 's'} not on the server yet`}
            description={`${formatBytes(backlog.data.bytes)} on this PC, across every account played here. Only recordings that found their game can go — the server keeps each against its game.`}
            control={
              <button type="button" className={primaryButtonClass} onClick={() => setEverything(true)}>
                Upload all
              </button>
            }
          />
        )}

        {note && (
          <SettingsBlock>
            <p className="text-xs text-accent">{note}</p>
          </SettingsBlock>
        )}
      </SettingsCard>

      {settings.data && (
        <SettingsCard title="Titles" description="What each recording is called on the server, from its own game.">
          <TitleTemplate
            label="Title"
            template={settings.data.titleTemplate}
            defaultTemplate={DEFAULT_TITLE_TEMPLATE}
            tokens={TITLE_TOKENS}
            preview={(template) => renderRecordingTitle(template, PREVIEW_FACTS)}
            onSave={(titleTemplate) => save.mutate({ titleTemplate })}
          />

          <TitleTemplate
            label="TFT title"
            template={settings.data.tftTitleTemplate}
            defaultTemplate={DEFAULT_TFT_TITLE_TEMPLATE}
            tokens={TFT_TITLE_TOKENS}
            preview={(template) => renderTftRecordingTitle(template, TFT_PREVIEW_FACTS)}
            onSave={(tftTitleTemplate) => save.mutate({ tftTitleTemplate })}
          />
        </SettingsCard>
      )}

      {everything && backlog.data && (
        <BulkUploadDialog
          recordings={[]}
          everything={backlog.data}
          onClose={() => setEverything(false)}
          onQueued={(result: BulkUploadResult) => {
            setNote(
              result.queued === 0
                ? 'Nothing was queued.'
                : `Queued ${result.queued} upload${result.queued === 1 ? '' : 's'}, ${formatBytes(result.queuedBytes)} in all.`
            )
            void queryClient.invalidateQueries({ queryKey: ['recordings'] })
          }}
        />
      )}
    </SettingsPage>
  )
}

/**
 * The title every upload of one game gets, previewed against a game as it is
 * typed. League's and TFT's are separate: what a title can say about a game is
 * that game's — a score, or a place.
 */
function TitleTemplate({
  label,
  template,
  defaultTemplate,
  tokens,
  preview,
  onSave
}: {
  label: string
  template: string
  defaultTemplate: string
  tokens: readonly string[]
  preview: (template: string) => string
  onSave: (template: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(template)
  useEffect(() => setDraft(template), [template])

  const dirty = draft.trim() !== template.trim()

  return (
    <SettingsBlock
      label={label}
      description={
        <>
          Words in braces are filled in from the game: {tokens.map((token) => `{${token}}`).join(', ')}.
          One with nothing to say is left out.
        </>
      }
    >
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={defaultTemplate}
          aria-label={label}
          className={`${inputClass} flex-1`}
        />
        <button type="button" className={ghostButtonClass} disabled={!dirty} onClick={() => onSave(draft)}>
          Save
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          disabled={template === defaultTemplate}
          onClick={() => onSave('')}
        >
          Default
        </button>
      </div>
      <p className="mt-2 text-2xs text-text-mute">
        Reads as: <span className="text-text-dim">{preview(draft || defaultTemplate)}</span>
      </p>
    </SettingsBlock>
  )
}
