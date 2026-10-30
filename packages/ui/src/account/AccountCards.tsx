import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { AccountEmail, EmailChange, PasswordChange } from '@foxfire/core'
import { passwordProblem, MINIMUM_PASSWORD } from '@foxfire/core/server'
import { SettingsCard } from '../components/settings/SettingsCard'
import { SettingsBlock, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass, primaryButtonClass } from '../components/settings/controls'

/**
 * What a save answered with.
 *
 * A result rather than a thrown error, the way every administrative write on
 * this server already answers: the reason a change was refused — the wrong
 * current password, an address somebody else has — is the most useful thing on
 * the screen, and it belongs under the form rather than in a stack trace.
 */
export interface AccountSaveResult {
  ok: boolean
  error: string | null
}

/**
 * The three things somebody can change about their own account.
 *
 * Cards rather than a page, because the two clients put them in different
 * places: the web client has an Account page of its own, and the desktop shows
 * them under the server it is signed in to, beside the address and the League
 * accounts. Both get the same forms and the same sentences.
 */
export function ChangeUsernameCard({
  username,
  onSave
}: {
  username: string
  onSave: (username: string) => Promise<AccountSaveResult>
}): JSX.Element {
  const [value, setValue] = useState(username)
  const save = useSave()

  const unchanged = value.trim() === username

  return (
    <SettingsCard title="Name">
      <SettingsBlock
        label="Username"
        description="What everybody here sees beside your games. Not what you sign in with."
      >
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            minLength={3}
            maxLength={32}
            autoComplete="username"
            aria-label="Username"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={save.busy || unchanged || value.trim().length < 3}
            className={primaryButtonClass}
            onClick={() => void save.run(() => onSave(value.trim()), 'Saved.')}
          >
            {save.busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </SettingsBlock>

      <Outcome outcome={save.outcome} />
    </SettingsCard>
  )
}

/**
 * Changing the address you sign in with.
 *
 * One address this cannot move is the one a server's configuration names as its
 * head admin. The card used to leave that to the server, on the grounds that
 * Admin__Email is configuration no client can see — and so it asked the owner
 * for their password and then refused. The server now says so with the address
 * (`addressPinned`): the members list already tells every admin which account
 * that is, and the one holding it learns nothing new. A server too old to say
 * still refuses on save, as before.
 *
 * On a server that sends mail, saving does not move you yet: a link goes to the
 * new address, and the move happens when it is opened — so a typo cannot leave
 * you signing in with an address nobody reads. The card says where you are
 * moving to while it waits, and offers the link again or a change of mind.
 */
export function ChangeEmailCard({
  email,
  onSave,
  status,
  onResend,
  onCancelPending
}: {
  email: string
  onSave: (change: EmailChange) => Promise<AccountSaveResult>
  /** Your address as the server sees it — confirmed or not, and any move waiting. Absent without mail. */
  status?: AccountEmail | null
  /** Another confirmation link. */
  onResend?: () => Promise<AccountSaveResult>
  /** Stops a move that has not been confirmed. */
  onCancelPending?: () => Promise<AccountSaveResult>
}): JSX.Element {
  const other = useSave()

  const mail = status?.mailEnabled ?? false
  const pending = status?.pendingEmail ?? null
  const pinned = status?.addressPinned ?? false

  return (
    <SettingsCard title="Email">
      {mail && status && !pending && (
        <StatusRow tone={status.emailConfirmed ? 'good' : 'warn'}>
          {status.emailConfirmed
            ? 'Confirmed. If you forget your password, you can reset it yourself from the sign-in page.'
            : status.suppressed
              ? 'Mail to this address bounced, so it cannot be confirmed. Change it to one that works.'
              : "Not confirmed yet — open the link we emailed you. Until you do, a forgotten password means asking an admin."}
        </StatusRow>
      )}

      {pending && (
        <SettingsBlock label="Moving to" description="Open the link sent there to finish. Until you do, you sign in with the address you have now.">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-text">{pending}</span>
            {onResend && (
              <button
                type="button"
                disabled={other.busy}
                className={ghostButtonClass}
                onClick={() => void other.run(onResend, `Sent another link to ${pending}.`)}
              >
                Send again
              </button>
            )}
            {onCancelPending && (
              <button
                type="button"
                disabled={other.busy}
                className={ghostButtonClass}
                onClick={() => void other.run(onCancelPending, 'Cancelled. Your address stays as it is.')}
              >
                Cancel
              </button>
            )}
          </div>
        </SettingsBlock>
      )}

      {mail && status && !status.emailConfirmed && !pending && !status.suppressed && onResend && (
        <SettingsBlock>
          <button
            type="button"
            disabled={other.busy}
            className={ghostButtonClass}
            onClick={() => void other.run(onResend, `Sent a new link to ${email}.`)}
          >
            Send the confirmation link again
          </button>
        </SettingsBlock>
      )}

      <Outcome outcome={other.outcome} />

      {pinned ? (
        <>
          <SettingsBlock label="Email" description="What you sign in with.">
            <p className="truncate text-sm text-text">{email}</p>
          </SettingsBlock>
          <StatusRow tone="mute">
            This server&apos;s configuration names this address as its head admin, so it is set there rather
            than here. Moving it means changing ADMIN_EMAIL (Admin__Email) and restarting the server.
          </StatusRow>
        </>
      ) : (
        <ChangeEmailForm email={email} mail={mail} onSave={onSave} />
      )}
    </SettingsCard>
  )
}

/** The address and the password that move it, for everybody whose address is theirs to move. */
function ChangeEmailForm({
  email,
  mail,
  onSave
}: {
  email: string
  mail: boolean
  onSave: (change: EmailChange) => Promise<AccountSaveResult>
}): JSX.Element {
  const [value, setValue] = useState(email)
  const [password, setPassword] = useState('')
  const save = useSave()

  return (
    <>
      <SettingsBlock label="Email" description="What you sign in with.">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="email"
          aria-label="Email"
          className={clsx(inputClass, 'w-full')}
        />
      </SettingsBlock>

      <SettingsBlock
        label="Current password"
        description="Asked for because a session is not proof of the person: somebody at an unlocked browser has one."
      >
        <div className="flex gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-label="Current password"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={save.busy || !password || !value.trim() || value.trim() === email}
            className={primaryButtonClass}
            onClick={() =>
              void save.run(
                () => onSave({ email: value.trim(), currentPassword: password }),
                mail
                  ? `We've emailed a link to ${value.trim()}. Your address changes when you open it.`
                  : 'Saved. Sign in with the new address from now on.',
                () => setPassword('')
              )
            }
          >
            {save.busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </SettingsBlock>

      <Outcome outcome={save.outcome} />
    </>
  )
}

export function ChangePasswordCard({
  onSave
}: {
  onSave: (change: PasswordChange) => Promise<AccountSaveResult>
}): JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const save = useSave()

  function submit(): void {
    const problem = passwordProblem(next, confirmation)
    if (problem !== null) {
      save.fail(problem)
      return
    }

    void save.run(
      () => onSave({ currentPassword: current, newPassword: next }),
      'Saved. Every other device has been signed out.',
      () => {
        setCurrent('')
        setNext('')
        setConfirmation('')
      }
    )
  }

  return (
    <SettingsCard
      title="Password"
      description="Changing it signs out every other device — this one stays signed in. If the old password had got out, nothing minted from it survives."
    >
      <SettingsBlock label="Current password">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          aria-label="Current password"
          className={clsx(inputClass, 'w-full')}
        />
      </SettingsBlock>

      <SettingsBlock label="New password" description={`At least ${MINIMUM_PASSWORD} characters.`}>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          aria-label="New password"
          className={clsx(inputClass, 'w-full')}
        />
      </SettingsBlock>

      <SettingsBlock label="Confirm new password">
        <div className="flex gap-2">
          <input
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            autoComplete="new-password"
            aria-label="Confirm new password"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={save.busy || !current || !next || !confirmation}
            className={primaryButtonClass}
            onClick={submit}
          >
            {save.busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </SettingsBlock>

      <Outcome outcome={save.outcome} />
    </SettingsCard>
  )
}

/* -------------------------------------------------------------------------- */

interface Outcome {
  tone: 'good' | 'error'
  message: string
}

/** The half of each card that is the same: busy, what happened, and saying so. */
function useSave(): {
  busy: boolean
  outcome: Outcome | null
  run: (save: () => Promise<AccountSaveResult>, done: string, onDone?: () => void) => Promise<void>
  fail: (message: string) => void
} {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  return {
    busy,
    outcome,
    fail: (message) => setOutcome({ tone: 'error', message }),
    async run(save, done, onDone) {
      setBusy(true)
      setOutcome(null)

      try {
        const result = await save()

        if (result.ok) {
          setOutcome({ tone: 'good', message: done })
          onDone?.()
        } else {
          setOutcome({ tone: 'error', message: result.error ?? 'That could not be saved.' })
        }
      } catch (err: unknown) {
        setOutcome({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        setBusy(false)
      }
    }
  }
}

function Outcome({ outcome }: { outcome: Outcome | null }): ReactNode {
  if (outcome === null) return null
  return <StatusRow tone={outcome.tone}>{outcome.message}</StatusRow>
}
