import { useState } from 'react'
import clsx from 'clsx'
import type { AdminActionResult, AdminInvite, ShareLink } from '@foxfire/core'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass, primaryButtonClass } from '../components/settings/controls'
import { EmptyState } from '../components/EmptyState'
import { ShowMoreButton } from '../components/ShowMore'
import * as Icon from '../components/icons'
import { MailStatus } from './mailStatus'

export interface InvitesPageProps {
  /** Every invite that can still be used. They expire, so this is never long. */
  outstanding: AdminInvite[]
  /** The pages of used invites fetched so far, most recently used first. */
  used: AdminInvite[]
  invitesLoading: boolean
  /** Whether there is another page of used invites after `used`. */
  hasMoreUsed: boolean
  loadingMoreUsed: boolean
  onShowMoreUsed: () => void
  publicSignup: boolean
  settingsLoading: boolean

  onSetPublicSignup: (on: boolean) => Promise<void>
  /**
   * Resolves with a new link for whoever opens it first — or, given an address,
   * with the invite for it, which may be the one already outstanding.
   */
  onCreateInvite: (email?: string) => Promise<AdminInvite>
  onRevokeInvite: (id: string) => Promise<AdminActionResult>
  onCopy: (text: string) => void
  /**
   * Whether this server sends mail. With it, an invite with an address is
   * emailed there as well as shown here. Undefined while it is not yet known.
   */
  mailEnabled?: boolean
  /** Emails an invite's link to its address — offered only where the invite says `canEmail`. */
  onEmailInvite?: (id: string) => Promise<AdminActionResult>

  /**
   * Whether anybody can read the server without signing in. Undefined from a
   * server too old to have the switch, and then it is not offered.
   */
  publicAccess?: boolean
  onSetPublicAccess: (on: boolean) => Promise<void>
  /** The share links fetched so far that still open something, newest first. */
  shareLinks: ShareLink[]
  shareLinksLoading: boolean
  hasMoreShareLinks: boolean
  loadingMoreShareLinks: boolean
  onShowMoreShareLinks: () => void
  /** Copies a link. Absent where the server does not say where its web client is. */
  onCopyShareLink?: (link: ShareLink) => void
  onRevokeShareLink: (id: string) => Promise<AdminActionResult>
}

/**
 * How somebody gets an account on this server, and how somebody without one
 * gets to look.
 *
 * The switch and the invite list are one page because they are one decision:
 * invites only matter while public sign-up is off, and turning it off is what
 * makes them the way in. Who is already here is the Members page — a server
 * with forty people on it should not make an admin scroll past all of them to
 * reach the box that sends an invite.
 *
 * Looking in is the same question asked of reading: open to anybody, or to
 * members and whoever they have shared a profile with — and the shared links
 * are listed so an admin can see what is out there and withdraw it.
 */
export function InvitesPage({
  outstanding,
  used,
  invitesLoading,
  hasMoreUsed,
  loadingMoreUsed,
  onShowMoreUsed,
  publicSignup,
  settingsLoading,
  onSetPublicSignup,
  onCreateInvite,
  onRevokeInvite,
  onCopy,
  mailEnabled = false,
  onEmailInvite,
  publicAccess,
  onSetPublicAccess,
  shareLinks,
  shareLinksLoading,
  hasMoreShareLinks,
  loadingMoreShareLinks,
  onShowMoreShareLinks,
  onCopyShareLink,
  onRevokeShareLink
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
      intro={
        mailEnabled
          ? 'Who can make an account here, and the links that let them in. Give an address and the link is emailed there; either way it is yours to copy and pass on — in Discord, or wherever your community talks.'
          : "Who can make an account here, and the links that let them in. This server doesn't send mail, so an invite is a link you pass on yourself — in Discord, or wherever your community talks."
      }
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

      {/* Beside joining, and above the invites: both switches at the top, and
          the shared links before a list of everybody who ever joined. */}
      {publicAccess !== undefined && (
        <SettingsCard title="Looking in">
          <SettingsRow
            label="Anyone can look without signing in"
            description={
              publicAccess
                ? 'Anybody who knows this address can read every profile, game and rank here — but not sync, edit or download anything. Who claimed which account and what members attached stay hidden.'
                : 'Only members can read this server, and whoever a member shares one profile with.'
            }
            control={
              <button
                type="button"
                disabled={settingsLoading || busy}
                className={ghostButtonClass}
                onClick={() =>
                  act(async () => {
                    await onSetPublicAccess(!publicAccess)
                    return { ok: true, error: null }
                  })
                }
              >
                {publicAccess ? 'Turn off' : 'Turn on'}
              </button>
            }
          />
        </SettingsCard>
      )}

      <SharedLinks
        links={shareLinks}
        loading={shareLinksLoading}
        hasMore={hasMoreShareLinks}
        loadingMore={loadingMoreShareLinks}
        onShowMore={onShowMoreShareLinks}
        onCopy={onCopyShareLink}
        onRevoke={(id) => act(() => onRevokeShareLink(id))}
        publicAccess={publicAccess ?? false}
      />

      <Invites
        outstanding={outstanding}
        used={used}
        loading={invitesLoading}
        hasMoreUsed={hasMoreUsed}
        loadingMoreUsed={loadingMoreUsed}
        onShowMoreUsed={onShowMoreUsed}
        publicSignup={publicSignup}
        onCreate={onCreateInvite}
        onRevoke={(id) => act(() => onRevokeInvite(id))}
        onEmail={onEmailInvite ? (id) => act(() => onEmailInvite(id)) : undefined}
        onCopy={onCopy}
        onError={setError}
        mailEnabled={mailEnabled}
      />
    </SettingsPage>
  )
}

/**
 * The profiles members have opened to somebody outside, while their links last.
 *
 * Every member may share, so this is where an admin sees what is out there —
 * and takes back a link somebody should not have posted.
 */
function SharedLinks({
  links,
  loading,
  hasMore,
  loadingMore,
  onShowMore,
  onCopy,
  onRevoke,
  publicAccess
}: {
  links: ShareLink[]
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onShowMore: () => void
  onCopy?: (link: ShareLink) => void
  onRevoke: (id: string) => void
  publicAccess: boolean
}): JSX.Element {
  return (
    <SettingsCard
      title="Shared profiles"
      description={
        publicAccess
          ? 'Every profile is open to anybody while looking in is on, so these only matter once it is off again.'
          : 'Links members made to show one profile to somebody without an account. Each opens that profile, read-only, for a week.'
      }
    >
      {loading && <SettingsRow label="Loading…" />}

      {!loading && links.length === 0 && (
        <SettingsBlock label="Open links">
          <EmptyState
            icon={<Icon.Link />}
            title="Nobody has shared a profile"
            description="A member's Share button on a profile makes one, and it shows up here until it runs out."
          />
        </SettingsBlock>
      )}

      {links.map((link) => (
        <SettingsRow
          key={link.id}
          label={`${link.gameName}#${link.tagLine}`}
          description={`Shared by ${link.createdBy ?? 'a member since deleted'} · Expires ${formatDate(link.expiresAt)}`}
          control={
            <>
              {onCopy && (
                <button type="button" className={ghostButtonClass} onClick={() => onCopy(link)}>
                  Copy link
                </button>
              )}
              <button type="button" className={ghostButtonClass} onClick={() => onRevoke(link.id)}>
                Withdraw
              </button>
            </>
          }
        />
      ))}

      {hasMore && <ShowMoreButton variant="settings" onClick={onShowMore} loading={loadingMore} />}
    </SettingsCard>
  )
}

/* -------------------------------------------------------------------------- */

function Invites({
  outstanding,
  used,
  loading,
  hasMoreUsed,
  loadingMoreUsed,
  onShowMoreUsed,
  publicSignup,
  onCreate,
  onRevoke,
  onEmail,
  onCopy,
  onError,
  mailEnabled
}: {
  outstanding: AdminInvite[]
  used: AdminInvite[]
  loading: boolean
  hasMoreUsed: boolean
  loadingMoreUsed: boolean
  onShowMoreUsed: () => void
  publicSignup: boolean
  onCreate: (email?: string) => Promise<AdminInvite>
  onRevoke: (id: string) => void
  onEmail?: (id: string) => void
  onCopy: (text: string) => void
  onError: (message: string | null) => void
  mailEnabled: boolean
}): JSX.Element {
  const [email, setEmail] = useState('')
  const [created, setCreated] = useState<AdminInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)

  function create(): void {
    setCreating(true)
    onCreate(email.trim() || undefined)
      .then((invite) => {
        setCreated(invite)
        setCopied(false)
        setEmail('')
        onError(null)
      })
      .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false))
  }

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
        description={
          mailEnabled
            ? "A link that signs up one person: it works once, and runs out on its own. Add their email and it's sent to them, and filled in when they sign up."
            : "A link that signs up one person: it works once, and runs out on its own. Add their email if you like, and it's filled in for them."
        }
      >
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !creating) create()
            }}
            placeholder="friend@example.com (optional)"
            aria-label="Their email (optional)"
            spellCheck={false}
            autoCapitalize="off"
            className={clsx(inputClass, 'flex-1')}
          />
          <button type="button" disabled={creating} className={primaryButtonClass} onClick={create}>
            {creating ? 'Creating…' : 'Create invite link'}
          </button>
        </div>

        {created !== null && (
          <div className="mt-3 rounded-md border border-hairline bg-surface-2 p-3">
            <p className="text-2xs text-text-mute">
              {created.email !== null ? (
                <>
                  Invite for <span className="text-text-dim">{created.email}</span>.
                </>
              ) : (
                'Invite link.'
              )}{' '}
              Works for one account until {formatDate(created.expiresAt)}, and can be opened as many times as you
              like until then.
              {created.mail && ' It is being emailed to them too.'}
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
          label={invite.email ?? 'Invite link'}
          description={
            <>
              Created {formatDate(invite.createdAt)} · Expires {formatDate(invite.expiresAt)}
              {invite.mail && <MailStatus mail={invite.mail} className="mt-1 flex" />}
            </>
          }
          control={
            <>
              {invite.canEmail && onEmail && (
                <button type="button" className={ghostButtonClass} onClick={() => onEmail(invite.id)}>
                  {invite.mail ? 'Email again' : 'Email it'}
                </button>
              )}
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
          label={invite.email ?? 'Invite link'}
          description={`Used by ${invite.redeemedBy ?? 'an account since deleted'}`}
          control={<span className="text-2xs text-text-mute">Used</span>}
        />
      ))}

      {hasMoreUsed && <ShowMoreButton variant="settings" onClick={onShowMoreUsed} loading={loadingMoreUsed} />}
    </SettingsCard>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}
