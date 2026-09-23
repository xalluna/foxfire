import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_TITLE_TEMPLATE,
  TITLE_TOKENS,
  renderRecordingTitle
} from '@foxfire/core/youtube'
import {
  SettingsBlock,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  StatusRow,
  ToggleRow,
  dangerButtonClass,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  selectClass
} from '@foxfire/ui'
import { YOUTUBE_LINKS } from '../youtube/links'
import type { YouTubePrivacy, YouTubeSettings as Settings, YouTubeState } from '@shared/types'

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

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  // What ipcRenderer.invoke wraps a thrown error in, which is nobody's business.
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * Putting recordings on YouTube.
 *
 * One Google connection for this machine: every account played here uploads
 * to the same channel. The sign-in happens in the browser, on Google's own
 * page, and all this page ever learns is the address it went to.
 */
export function YouTubeSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const state = useQuery({ queryKey: ['youtubeState'], queryFn: () => window.api.youtube.getState() })
  const settings = useQuery({ queryKey: ['youtubeSettings'], queryFn: () => window.api.youtube.getSettings() })
  const [connectError, setConnectError] = useState<string | null>(null)

  const connect = useMutation({
    mutationFn: () => window.api.youtube.connect(),
    onMutate: () => setConnectError(null),
    onError: (err) => setConnectError(errorText(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['youtubeState'] })
  })

  const disconnect = useMutation({
    mutationFn: () => window.api.youtube.disconnect(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['youtubeState'] })
  })

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.api.youtube.setSettings(patch),
    onSuccess: (next) => queryClient.setQueryData(['youtubeSettings'], next)
  })

  const youtube = state.data
  const connected = youtube?.email !== null && youtube?.email !== undefined

  return (
    <SettingsPage
      title="YouTube"
      intro={
        <>
          Puts recordings on your own YouTube channel, and tells your Foxfire Server about them so
          everybody on it can watch — with your kills and deaths marked on the timeline. Uploads run in
          the background, pause while you are in a game, and pick up where they left off after a restart.
        </>
      }
    >
      <SettingsCard title="Channel">
        <ConnectionStatus state={youtube} error={connectError} />

        {youtube?.configured && (
          <SettingsRow
            label={connected ? `Connected as ${youtube.email ?? 'your Google account'}` : 'Not connected'}
            description={
              connected
                ? 'Every account you play on this PC uploads to this channel. Disconnecting stops new uploads; videos already on YouTube stay there.'
                : 'Opens Google in your browser to choose a channel. Foxfire only asks to upload videos — it cannot see, change or delete anything on your channel.'
            }
            control={
              connected ? (
                <button
                  type="button"
                  className={dangerButtonClass}
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  Disconnect
                </button>
              ) : youtube.connecting ? (
                <>
                  <span className="text-2xs text-text-mute">Waiting for Google…</span>
                  <button type="button" className={ghostButtonClass} onClick={() => void window.api.youtube.cancelConnect()}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className={primaryButtonClass} onClick={() => connect.mutate()}>
                  Connect YouTube
                </button>
              )
            }
          />
        )}

        <SettingsBlock>
          <p className="text-2xs leading-relaxed text-text-mute">
            Uploading means agreeing to the{' '}
            <ExternalLink href={YOUTUBE_LINKS.terms}>YouTube Terms of Service</ExternalLink>. Google handles
            what you upload under the <ExternalLink href={YOUTUBE_LINKS.googlePrivacy}>Google Privacy Policy</ExternalLink>
            ; what Foxfire keeps is in <ExternalLink href={YOUTUBE_LINKS.foxfirePrivacy}>its own</ExternalLink>. You can
            take Foxfire&rsquo;s access away at any time from your{' '}
            <ExternalLink href={YOUTUBE_LINKS.revoke}>Google account&rsquo;s permissions</ExternalLink>.
          </p>
        </SettingsBlock>
      </SettingsCard>

      {settings.data && (
        <SettingsCard
          title="Uploads"
          description="What a new upload starts with. The upload form lets you change all of it, one recording at a time."
        >
          <ToggleRow
            label="Upload every game automatically"
            description="Once a recording finds its game — or is given up on — it goes to YouTube with the title and privacy below. Off unless you turn it on."
            checked={settings.data.autoUpload}
            disabled={!connected}
            onChange={(autoUpload) => save.mutate({ autoUpload })}
          />

          <SettingsRow
            label="Who can watch"
            description="Unlisted is anybody with the link, which is everybody on your server and nobody who is not."
            control={
              <select
                value={settings.data.defaultPrivacy}
                onChange={(event) => save.mutate({ defaultPrivacy: event.target.value as YouTubePrivacy })}
                className={selectClass}
              >
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            }
          />

          <TitleTemplate
            template={settings.data.titleTemplate}
            onSave={(titleTemplate) => save.mutate({ titleTemplate })}
          />
        </SettingsCard>
      )}
    </SettingsPage>
  )
}

function ConnectionStatus({ state, error }: { state: YouTubeState | undefined; error: string | null }): JSX.Element | null {
  if (!state) return null

  if (!state.configured) {
    return (
      <StatusRow tone="mute">
        This build of Foxfire was made without YouTube uploads. The installer from the Releases page has them.
      </StatusRow>
    )
  }

  const message = error ?? state.error
  if (message) return <StatusRow tone="error">{message}</StatusRow>

  if (state.email && state.quotaResumesAt) {
    return (
      <StatusRow tone="warn">
        YouTube&rsquo;s daily upload quota is used up. Uploads carry on at{' '}
        {new Date(state.quotaResumesAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
      </StatusRow>
    )
  }

  if (state.email && state.pausedForGame) {
    return <StatusRow tone="mute">Uploads are paused while a game is on, and carry on when it ends.</StatusRow>
  }

  return null
}

/** The title every upload starts with, previewed against a game as it is typed. */
function TitleTemplate({ template, onSave }: { template: string; onSave: (template: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(template)
  useEffect(() => setDraft(template), [template])

  const dirty = draft.trim() !== template.trim()

  return (
    <SettingsBlock
      label="Title"
      description={
        <>
          Words in braces are filled in from the game: {TITLE_TOKENS.map((token) => `{${token}}`).join(', ')}.
          One with nothing to say — no result for a game that never found its match — is left out.
        </>
      }
    >
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={DEFAULT_TITLE_TEMPLATE}
          className={`${inputClass} flex-1`}
        />
        <button type="button" className={ghostButtonClass} disabled={!dirty} onClick={() => onSave(draft)}>
          Save
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          disabled={template === DEFAULT_TITLE_TEMPLATE}
          onClick={() => onSave('')}
        >
          Default
        </button>
      </div>
      <p className="mt-2 text-2xs text-text-mute">
        Reads as: <span className="text-text-dim">{renderRecordingTitle(draft || DEFAULT_TITLE_TEMPLATE, PREVIEW_FACTS)}</span>
      </p>
    </SettingsBlock>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  )
}
