import { useState } from 'react'
import clsx from 'clsx'
import type { AdminActionResult, AdminPasswordReset, AdminUser, AdminUserPatch } from '@foxfire/core'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass } from '../components/settings/controls'
import { EmptyState } from '../components/EmptyState'
import { filterMembers } from '../lib/members'
import * as Icon from '../components/icons'

export interface MembersPageProps {
  users: AdminUser[]
  usersLoading: boolean
  /** The address the person reading this signed in with, so their own row says so. */
  signedInAs?: string | null

  onUpdateUser: (id: string, patch: AdminUserPatch) => Promise<AdminActionResult>
  onDeleteUser: (id: string) => Promise<AdminActionResult>
  /** Makes a reset link, replacing whatever was outstanding for them. */
  onCreatePasswordReset: (id: string) => Promise<AdminPasswordReset>
  onRevokePasswordReset: (id: string) => Promise<AdminActionResult>
  onCopy: (text: string) => void
}

/**
 * Everybody on the server, one line each.
 *
 * A line rather than a card because this page is read far more often than it is
 * acted on — somebody checking whether a friend ever finished registering
 * should not have to scroll past four buttons per person to find out. The
 * detail and the actions are one click away, on the row itself, and a filter
 * covers the case this page was split out for: a server with more members than
 * fit on a screen.
 */
export function MembersPage({
  users,
  usersLoading,
  signedInAs,
  onUpdateUser,
  onDeleteUser,
  onCreatePasswordReset,
  onRevokePasswordReset,
  onCopy
}: MembersPageProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  /** Runs an action that can be refused, and shows the server's reason when it is. */
  function act(run: () => Promise<AdminActionResult>): void {
    setBusy(true)
    run()
      .then((result) => setError(result.ok ? null : result.error))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  const shown = filterMembers(users, query)

  return (
    <SettingsPage
      title="Members"
      intro="Everybody with an account on this server. Promoting, demoting or disabling somebody signs them out, so the change takes effect now rather than whenever their session happens to renew."
    >
      {error !== null && (
        <SettingsCard>
          <StatusRow tone="error">{error}</StatusRow>
        </SettingsCard>
      )}

      <SettingsCard>
        <SettingsBlock>
          <div className="flex items-center gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or email"
              spellCheck={false}
              autoCapitalize="off"
              aria-label="Filter members"
              className={clsx(inputClass, 'flex-1')}
            />
            <span className="shrink-0 text-2xs tabular-nums text-text-mute">
              {query.trim() ? `${shown.length} of ${users.length}` : plural(users.length, 'member')}
            </span>
          </div>
        </SettingsBlock>

        {usersLoading && <SettingsRow label="Loading…" />}

        {!usersLoading && shown.length === 0 && (
          <SettingsBlock>
            <EmptyState
              icon={<Icon.Search />}
              title={users.length === 0 ? 'Nobody here yet' : 'Nobody by that name'}
              description={
                users.length === 0
                  ? 'Anybody who registers or takes an invite shows up here.'
                  : 'Try part of a username or an email address.'
              }
            />
          </SettingsBlock>
        )}

        {shown.map((user) => (
          <Member
            key={user.id}
            user={user}
            isYou={signedInAs !== null && signedInAs !== undefined && signedInAs === user.email}
            expanded={open === user.id}
            busy={busy}
            onToggle={() => setOpen(open === user.id ? null : user.id)}
            onUpdate={(patch) => act(() => onUpdateUser(user.id, patch))}
            onDelete={() => act(() => onDeleteUser(user.id))}
            onCreateReset={() =>
              act(async () => {
                await onCreatePasswordReset(user.id)
                return { ok: true, error: null }
              })
            }
            onRevokeReset={() => act(() => onRevokePasswordReset(user.id))}
            onCopy={onCopy}
          />
        ))}
      </SettingsCard>
    </SettingsPage>
  )
}

/* -------------------------------------------------------------------------- */

function Member({
  user,
  isYou,
  expanded,
  busy,
  onToggle,
  onUpdate,
  onDelete,
  onCreateReset,
  onRevokeReset,
  onCopy
}: {
  user: AdminUser
  isYou: boolean
  expanded: boolean
  busy: boolean
  onToggle: () => void
  onUpdate: (patch: AdminUserPatch) => void
  onDelete: () => void
  onCreateReset: () => void
  onRevokeReset: () => void
  onCopy: (text: string) => void
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm text-text">
            <span className="truncate">{user.username}</span>
            {user.isAdmin && <Badge tone="accent">Admin</Badge>}
            {user.isDisabled && <Badge tone="red">Disabled</Badge>}
            {isYou && <Badge tone="mute">You</Badge>}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-2xs leading-relaxed text-text-mute">
            <span className="truncate">{user.email}</span>
            {user.passwordReset !== null && <Badge tone="mute">Reset link active</Badge>}
          </span>
        </div>
        <Icon.ChevronDown
          width={14}
          height={14}
          className={clsx('shrink-0 text-text-mute transition', !expanded && '-rotate-90')}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-hairline px-4 py-3">
          <p className="text-2xs leading-relaxed text-text-mute">
            {plural(user.linkedRiotAccounts, 'League account')} · {plural(user.activeSessions, 'session')} ·
            joined {new Date(user.createdAt).toLocaleDateString()}
          </p>

          {user.passwordReset !== null && (
            <div className="rounded-md border border-hairline bg-surface-2 p-3">
              <p className="text-2xs leading-relaxed text-text-mute">
                A reset link is outstanding, good until{' '}
                <span className="text-text-dim">
                  {new Date(user.passwordReset.expiresAt).toLocaleString()}
                </span>
                . Using it sets a new password and signs them out everywhere.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-2xs text-text-dim">
                  {user.passwordReset.link}
                </code>
                <CopyButton text={user.passwordReset.link} onCopy={onCopy} />
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={onRevokeReset}
                >
                  Withdraw
                </button>
              </div>
            </div>
          )}

          {user.isDisabled && (
            <p className="text-2xs leading-relaxed text-text-mute">
              Disabled accounts cannot sign in, so there is no reset link to send. Enable them first.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={ghostButtonClass}
              onClick={() => onUpdate({ isAdmin: !user.isAdmin })}
            >
              {user.isAdmin ? 'Demote' : 'Make admin'}
            </button>
            <button
              type="button"
              disabled={busy}
              className={ghostButtonClass}
              onClick={() => onUpdate({ isDisabled: !user.isDisabled })}
            >
              {user.isDisabled ? 'Enable' : 'Disable'}
            </button>
            {!user.isDisabled && (
              <button type="button" disabled={busy} className={ghostButtonClass} onClick={onCreateReset}>
                {user.passwordReset === null ? 'Reset link' : 'New reset link'}
              </button>
            )}

            {confirming ? (
              <>
                <span className="self-center text-2xs text-red">Remove {user.username}?</span>
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={ghostButtonClass}
                  onClick={() => {
                    setConfirming(false)
                    onDelete()
                  }}
                >
                  Remove
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                className={ghostButtonClass}
                onClick={() => setConfirming(true)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Copies, then says so for a moment — the same two states the invite panel has. */
function CopyButton({ text, onCopy }: { text: string; onCopy: (text: string) => void }): JSX.Element {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className={ghostButtonClass}
      onClick={() => {
        onCopy(text)
        setCopied(true)
      }}
    >
      {copied ? 'Copied' : 'Copy link'}
    </button>
  )
}

function Badge({ tone, children }: { tone: 'accent' | 'red' | 'mute'; children: string }): JSX.Element {
  return (
    <span
      className={clsx(
        'shrink-0 rounded border px-1.5 py-0.5 text-[10px]',
        tone === 'accent' && 'border-accent-dim/40 bg-accent/10 text-accent',
        tone === 'red' && 'border-red/30 bg-red/10 text-red',
        tone === 'mute' && 'border-hairline text-text-mute'
      )}
    >
      {children}
    </span>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
