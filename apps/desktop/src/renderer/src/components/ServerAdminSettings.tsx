import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { AdminInvite, AdminUser } from '@shared/types'
import { SettingsCard, SettingsPage } from './settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from './settings/SettingsRow'
import { ghostButtonClass, inputClass, primaryButtonClass } from './settings/controls'
import { EmptyState } from './EmptyState'
import * as Icon from './icons'

/**
 * Administering the server you are signed in to.
 *
 * Shown only when the active session says you are an admin, which decides what
 * to draw and nothing else — the server checks the role on every request, and
 * would refuse all of this to somebody demoted a minute ago whose window has
 * not caught up.
 *
 * Deliberately not where secrets are. The Riot API key, the connection strings
 * and the signing keys are environment configuration: changing one is an edit
 * and a restart, not a button, and putting a disabled field here for each of
 * them would only suggest otherwise. What is here is what can safely change
 * underneath a server that is running.
 */
export function ServerAdminSettings(): JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const users = useQuery({ queryKey: ['adminUsers'], queryFn: () => window.api.serverAdmin.users() })
  const invites = useQuery({ queryKey: ['adminInvites'], queryFn: () => window.api.serverAdmin.invites() })
  const settings = useQuery({
    queryKey: ['adminSettings'],
    queryFn: () => window.api.serverAdmin.getSettings()
  })

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    void queryClient.invalidateQueries({ queryKey: ['adminInvites'] })
    void queryClient.invalidateQueries({ queryKey: ['adminSettings'] })
  }

  /** Runs an action that can be refused, and shows the server's reason when it is. */
  const act = useMutation({
    mutationFn: (run: () => Promise<{ ok: boolean; error: string | null }>) => run(),
    onSuccess: (result) => {
      setError(result.ok ? null : result.error)
      refresh()
    }
  })

  const publicSignup = settings.data?.publicSignup ?? true

  return (
    <SettingsPage
      title="Server management"
      intro="You are an administrator on this server. Everything here changes while it runs — the Riot API key, the database and the signing keys are set in its configuration and need a restart."
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
              disabled={settings.isPending || act.isPending}
              className={ghostButtonClass}
              onClick={() =>
                act.mutate(async () => {
                  await window.api.serverAdmin.setSettings({ publicSignup: !publicSignup })
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
        invites={invites.data ?? []}
        loading={invites.isPending}
        publicSignup={publicSignup}
        onChanged={refresh}
        onError={setError}
      />

      <Users
        users={users.data ?? []}
        loading={users.isPending}
        busy={act.isPending}
        onAct={(run) => act.mutate(run)}
      />
    </SettingsPage>
  )
}

/* -------------------------------------------------------------------------- */

function Invites({
  invites,
  loading,
  publicSignup,
  onChanged,
  onError
}: {
  invites: AdminInvite[]
  loading: boolean
  publicSignup: boolean
  onChanged: () => void
  onError: (message: string | null) => void
}): JSX.Element {
  const [email, setEmail] = useState('')
  const [created, setCreated] = useState<AdminInvite | null>(null)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: (address: string) => window.api.serverAdmin.createInvite(address),
    onSuccess: (invite) => {
      setCreated(invite)
      setCopied(false)
      setEmail('')
      onError(null)
      onChanged()
    },
    onError: (err: Error) => onError(err.message)
  })

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
              if (e.key === 'Enter' && email.trim()) create.mutate(email.trim())
            }}
            placeholder="friend@example.com"
            spellCheck={false}
            autoCapitalize="off"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={!email.trim() || create.isPending}
            className={primaryButtonClass}
            onClick={() => create.mutate(email.trim())}
          >
            {create.isPending ? 'Creating…' : 'Create invite'}
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
                  void navigator.clipboard.writeText(created.link)
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
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => void navigator.clipboard.writeText(invite.link)}
              >
                Copy link
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() =>
                  void window.api.serverAdmin.revokeInvite(invite.id).then((result) => {
                    onError(result.ok ? null : result.error)
                    onChanged()
                  })
                }
              >
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

/* -------------------------------------------------------------------------- */

function Users({
  users,
  loading,
  busy,
  onAct
}: {
  users: AdminUser[]
  loading: boolean
  busy: boolean
  onAct: (run: () => Promise<{ ok: boolean; error: string | null }>) => void
}): JSX.Element {
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <SettingsCard
      title="People"
      description="Promoting or demoting somebody signs them out, so the change takes effect now rather than whenever their session happens to renew."
    >
      {loading && <SettingsRow label="Loading…" />}

      {users.map((user) => (
        <SettingsRow
          key={user.id}
          label={
            <span className="flex items-center gap-2">
              {user.username}
              {user.isAdmin && (
                <span className="rounded border border-accent-dim/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                  Admin
                </span>
              )}
              {user.isDisabled && (
                <span className="rounded border border-red/30 bg-red/10 px-1.5 py-0.5 text-[10px] text-red">
                  Disabled
                </span>
              )}
            </span>
          }
          description={
            `${user.email} · ${plural(user.linkedRiotAccounts, 'League account')}` +
            ` · ${plural(user.activeSessions, 'session')}`
          }
          control={
            confirming === user.id ? (
              <>
                <span className="text-2xs text-red">Remove {user.username}?</span>
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={() => {
                    setConfirming(null)
                    onAct(() => window.api.serverAdmin.deleteUser(user.id))
                  }}
                >
                  Remove
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={() =>
                    onAct(() => window.api.serverAdmin.updateUser(user.id, { isAdmin: !user.isAdmin }))
                  }
                >
                  {user.isAdmin ? 'Demote' : 'Make admin'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={() =>
                    onAct(() =>
                      window.api.serverAdmin.updateUser(user.id, { isDisabled: !user.isDisabled })
                    )
                  }
                >
                  {user.isDisabled ? 'Enable' : 'Disable'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={() => setConfirming(user.id)}
                >
                  Remove
                </button>
              </>
            )
          }
        />
      ))}
    </SettingsCard>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
