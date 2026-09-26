import { useState } from 'react'
import clsx from 'clsx'
import type { AdminActionResult, AdminPasswordReset, AdminUser, AdminUserPatch } from '@foxfire/core'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass } from '../components/settings/controls'
import { EmptyState } from '../components/EmptyState'
import { ShowMoreButton } from '../components/ShowMore'
import { memberCountLabel } from '../lib/members'
import * as Icon from '../components/icons'

export interface MembersPageProps {
  /** The pages of members fetched so far, matching `query`. */
  users: AdminUser[]
  /** How many match `query` altogether — everybody, when it is blank. */
  total: number
  usersLoading: boolean
  /** What the list is narrowed to: part of a username or an email address. */
  query: string
  onQueryChange: (query: string) => void
  /** Whether there is another page after `users`. */
  hasMore: boolean
  loadingMore: boolean
  onShowMore: () => void
  /** The address the person reading this signed in with, so their own row says so. */
  signedInAs?: string | null
  /**
   * Whether the person reading this is a head admin: whether they may demote,
   * disable, remove or make a reset link for another admin, and make somebody
   * a head admin. A plain admin's page offers none of those on another admin's
   * row rather than buttons the server refuses.
   */
  canManageAdmins: boolean

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
 * detail and the actions are one click away, on the row itself, and a search
 * covers the case this page was split out for: a server with more members than
 * fit on a screen. The server does the searching and hands the list over a page
 * at a time, since a community that fills a page of it is exactly the one a
 * whole list stops working for.
 */
export function MembersPage({
  users,
  total,
  usersLoading,
  query,
  onQueryChange,
  hasMore,
  loadingMore,
  onShowMore,
  signedInAs,
  canManageAdmins,
  onUpdateUser,
  onDeleteUser,
  onCreatePasswordReset,
  onRevokePasswordReset,
  onCopy
}: MembersPageProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  /** Runs an action that can be refused, and shows the server's reason when it is. */
  function act(run: () => Promise<AdminActionResult>): void {
    setBusy(true)
    run()
      .then((result) => setError(result.ok ? null : result.error))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  const typed = query.trim()

  return (
    <SettingsPage
      title="Members"
      intro="Everybody with an account on this server. Any admin can make somebody an admin or let them back in; demoting, disabling or removing another admin is a head admin's, and so is making anybody a head admin. Changing somebody's role or disabling them signs them out, so the change takes effect now rather than whenever their session happens to renew."
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
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Find by name or email"
              spellCheck={false}
              autoCapitalize="off"
              aria-label="Find members"
              className={clsx(inputClass, 'flex-1')}
            />
            {!usersLoading && (
              <span className="shrink-0 text-2xs tabular-nums text-text-mute">
                {memberCountLabel(total, query)}
              </span>
            )}
          </div>
        </SettingsBlock>

        {usersLoading && <SettingsRow label="Loading…" />}

        {!usersLoading && users.length === 0 && (
          <SettingsBlock>
            <EmptyState
              icon={<Icon.Search />}
              title={typed ? 'Nobody by that name' : 'Nobody here yet'}
              description={
                typed
                  ? 'Try part of a username or an email address.'
                  : 'Anybody who registers or takes an invite shows up here.'
              }
            />
          </SettingsBlock>
        )}

        {users.map((user) => (
          <Member
            key={user.id}
            user={user}
            isYou={signedInAs !== null && signedInAs !== undefined && signedInAs === user.email}
            canManageAdmins={canManageAdmins}
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

        {hasMore && <ShowMoreButton variant="settings" onClick={onShowMore} loading={loadingMore} />}
      </SettingsCard>
    </SettingsPage>
  )
}

/* -------------------------------------------------------------------------- */

function Member({
  user,
  isYou,
  canManageAdmins,
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
  canManageAdmins: boolean
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

  // The two rows whose actions are not all open. The configured admin's are
  // nobody's; another admin's are a head admin's. Both say why, once, rather
  // than leaving buttons the server would refuse.
  const pinned = user.isConfiguredAdmin
  const guarded = !pinned && user.isAdmin && !isYou && !canManageAdmins

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
            {user.isHeadAdmin ? (
              <Badge tone="accent">Head admin</Badge>
            ) : (
              user.isAdmin && <Badge tone="accent">Admin</Badge>
            )}
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

          {user.isDisabled && !guarded && (
            <p className="text-2xs leading-relaxed text-text-mute">
              Disabled accounts cannot sign in, so there is no reset link to send. Enable them first.
            </p>
          )}

          {pinned && (
            <p className="text-2xs leading-relaxed text-text-mute">
              This server&apos;s configuration names them as its head admin, so nobody can demote,
              disable or remove them from here. Handing the server over means changing ADMIN_EMAIL
              and restarting it.
            </p>
          )}

          {guarded && (
            <p className="text-2xs leading-relaxed text-text-mute">
              Only a head admin can demote, disable or remove another admin, or make them a reset
              link.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!pinned && !guarded && (
              <button
                type="button"
                disabled={busy}
                className={ghostButtonClass}
                onClick={() => onUpdate({ isAdmin: !user.isAdmin })}
              >
                {user.isAdmin ? 'Demote' : 'Make admin'}
              </button>
            )}
            {!pinned && canManageAdmins && (
              <button
                type="button"
                disabled={busy}
                className={ghostButtonClass}
                onClick={() => onUpdate({ isHeadAdmin: !user.isHeadAdmin })}
              >
                {user.isHeadAdmin ? 'Remove head admin' : 'Make head admin'}
              </button>
            )}
            {!pinned && (!guarded || user.isDisabled) && (
              <button
                type="button"
                disabled={busy}
                className={ghostButtonClass}
                onClick={() => onUpdate({ isDisabled: !user.isDisabled })}
              >
                {user.isDisabled ? 'Enable' : 'Disable'}
              </button>
            )}
            {!user.isDisabled && !guarded && (
              <button type="button" disabled={busy} className={ghostButtonClass} onClick={onCreateReset}>
                {user.passwordReset === null ? 'Reset link' : 'New reset link'}
              </button>
            )}

            {pinned || guarded ? null : confirming ? (
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
