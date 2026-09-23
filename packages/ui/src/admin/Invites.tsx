import { useState } from 'react'
import clsx from 'clsx'
import type { AdminActionResult, AdminInvite } from '@foxfire/core'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass, primaryButtonClass } from '../components/settings/controls'
import { EmptyState } from '../components/EmptyState'
import * as Icon from '../components/icons'

export interface InvitesPageProps {
  invites: AdminInvite[]
  invitesLoading: boolean
  publicSignup: boolean
  settingsLoading: boolean

  onSetPublicSignup: (on: boolean) => Promise<void>
  /** Resolves with the invite, or the one already outstanding for that address. */
  onCreateInvite: (email: string) => Promise<AdminInvite>
  onRevokeInvite: (id: string) => Promise<AdminActionResult>
  onCopy: (text: string) => void
}

/**
 * How somebody gets an account on this server.
 *
 * The switch and the invite list are one page because they are one decision:
 * invites only matter while public sign-up is off, and turning it off is what
 * makes them the way in. Who is already here is the Members page — a server
 * with forty people on it should not make an admin scroll past all of them to
 * reach the box that sends an invite.
 */
export function InvitesPage({
  invites,
  invitesLoading,
  publicSignup,
  settingsLoading,
  onSetPublicSignup,
  onCreateInvite,
  onRevokeInvite,
  onCopy
}: InvitesPageProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Runs an action that can be refused, and shows the server's reason when it is. */
  function act(run: () => Promise<AdminActionResult>): void {
    setBusy(true)
    run()
      .then((result) => setError(result.ok ? null : result.error))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  return (
    <SettingsPage
      title="Invites"
      intro="Who can make an account here, and the links that let them. Foxfire sends mail only if this server has SMTP set up, so every link is also yours to copy and send however your community talks."
    >
      {error !== null && (
        <SettingsCard>
          <StatusRow tone="error">{error}</StatusRow>
        </SettingsCard>
      )}

      <SettingsCard title="Joining">
        <SettingsRow
          label="Anyone can make an account"
          description={
            publicSignup
              ? 'Anybody who knows this address can register.'
              : 'Only people you send an invite to can register.'
          }
          control={
            <button
              type="button"
              disabled={settingsLoading || busy}
              className={ghostButtonClass}
              onClick={() =>
                act(async () => {
                  await onSetPublicSignup(!publicSignup)
                  return { ok: true, error: null }
                })
              }
            >
              {publicSignup ? 'Turn off' : 'Turn on'}
            </button>
          }
        />
      </SettingsCard>

      <Invites
        invites={invites}
        loading={invitesLoading}
        publicSignup={publicSignup}
        onCreate={onCreateInvite}
        onRevoke={(id) => act(() => onRevokeInvite(id))}
        onCopy={onCopy}
        onError={setError}
      />
    </SettingsPage>
  )
}

/* -------------------------------------------------------------------------- */

function Invites({
  invites,
  loading,
  publicSignup,
  onCreate,
  onRevoke,
  onCopy,
  onError
}: {
  invites: AdminInvite[]
  loading: boolean
  publicSignup: boolean
  onCreate: (email: string) => Promise<AdminInvite>
  onRevoke: (id: string) => void
  onCopy: (text: string) => void
  onError: (message: string | null) => void
}): JSX.Element {
  const [email, setEmail] = useState('')
  const [created, setCreated] = useState<AdminInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)

  function create(address: string): void {
    setCreating(true)
    onCreate(address)
      .then((invite) => {
        setCreated(invite)
        setCopied(false)
        setEmail('')
        onError(null)
      })
      .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false))
  }

  const outstanding = invites.filter((i) => i.isOpen)
  const used = invites.filter((i) => i.redeemedAt !== null)

  return (
    <SettingsCard
      title="Invites"
      description={
        publicSignup
          ? 'Anyone can register while public sign-up is on, so these are only needed once you turn it off.'
          : undefined
      }
    >
      <SettingsBlock
        label="Invite somebody"
        description="Foxfire emails this if the server has mail set up. Either way you get the link to copy."
      >
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email.trim()) create(email.trim())
            }}
            placeholder="friend@example.com"
            spellCheck={false}
            autoCapitalize="off"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={!email.trim() || creating}
            className={primaryButtonClass}
            onClick={() => create(email.trim())}
          >
            {creating ? 'Creating…' : 'Create invite'}
          </button>
        </div>

        {created !== null && (
          <div className="mt-3 rounded-md border border-hairline bg-surface-2 p-3">
            <p className="text-2xs text-text-mute">
              Invite for <span className="text-text-dim">{created.email}</span>. It can be opened as
              many times as you like and will register one account.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-2xs text-text-dim">{created.link}</code>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => {
                  onCopy(created.link)
                  setCopied(true)
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
      </SettingsBlock>

      {loading && <SettingsRow label="Loading…" />}

      {!loading && outstanding.length === 0 && used.length === 0 && (
        <SettingsBlock label="Outstanding">
          <EmptyState
            icon={<Icon.Inbox />}
            title="No invites yet"
            description="Anybody you invite shows up here until they use it."
          />
        </SettingsBlock>
      )}

      {outstanding.map((invite) => (
        <SettingsRow
          key={invite.id}
          label={invite.email}
          description={`Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
          control={
            <>
              <button type="button" className={ghostButtonClass} onClick={() => onCopy(invite.link)}>
                Copy link
              </button>
              <button type="button" className={ghostButtonClass} onClick={() => onRevoke(invite.id)}>
                Withdraw
              </button>
            </>
          }
        />
      ))}

      {used.map((invite) => (
        <SettingsRow
          key={invite.id}
          label={invite.email}
          description={`Used by ${invite.redeemedBy ?? 'an account since deleted'}`}
          control={<span className="text-2xs text-text-mute">Used</span>}
        />
      ))}
    </SettingsCard>
  )
}
